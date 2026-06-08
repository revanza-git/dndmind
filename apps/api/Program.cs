using System.Text.Json;
using System.Text.RegularExpressions;
using System.Text;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Npgsql;
using NpgsqlTypes;

const string DemoClientOwnerId = "dndmind-demo-client";
var demoCampaignId = Guid.Parse("11111111-1111-1111-1111-111111111111");

var builder = WebApplication.CreateBuilder(args);

var connectionString =
    builder.Configuration.GetConnectionString("Postgres")
    ?? builder.Configuration["POSTGRES_CONNECTION_STRING"]
    ?? "Host=localhost;Port=5432;Database=dndmind;Username=dndmind;Password=dndmind";

builder.Services.AddSingleton(_ => NpgsqlDataSource.Create(connectionString));
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentClientService, CurrentClientService>();
builder.Services.AddTransient<CloudRunIdentityTokenHandler>();
builder.Services.AddHttpClient("ai-worker", client =>
{
    var workerUrl = builder.Configuration["AI_WORKER_URL"] ?? "http://localhost:8001";
    client.BaseAddress = new Uri(workerUrl);
}).AddHttpMessageHandler<CloudRunIdentityTokenHandler>();
builder.Services.AddCors(options =>
{
    var allowedOrigins = DeploymentConfig.ReadCsv(builder.Configuration["CORS_ALLOWED_ORIGINS"]);
    options.AddDefaultPolicy(policy =>
    {
        if (allowedOrigins.Length > 0)
        {
            policy.WithOrigins(allowedOrigins).AllowAnyMethod().AllowAnyHeader();
            return;
        }

        if (builder.Environment.IsDevelopment())
        {
            policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();
            return;
        }

        policy.SetIsOriginAllowed(_ => false).AllowAnyMethod().AllowAnyHeader();
    });
});

var app = builder.Build();
app.UseCors();
await EnsureRagSchema(app.Services.GetRequiredService<NpgsqlDataSource>());
await EnsureDemoSeedData(app.Services.GetRequiredService<NpgsqlDataSource>(), demoCampaignId, DemoClientOwnerId);

app.MapGet("/api/health", () => Results.Ok(new { status = "ok", service = "api" }));

app.MapGet("/api/campaigns", async (NpgsqlDataSource db) =>
{
    const string sql = """
        SELECT id, name, description, system_tone, current_session_id, archived_at, created_at, updated_at
        FROM campaigns
        WHERE archived_at IS NULL
        ORDER BY created_at DESC
        """;

    var campaigns = new List<CampaignDto>();
    await using var cmd = db.CreateCommand(sql);
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        campaigns.Add(ReadCampaign(reader));
    }

    return Results.Ok(campaigns);
});

app.MapGet("/api/campaigns/archived", async (NpgsqlDataSource db) =>
{
    const string sql = """
        SELECT id, name, description, system_tone, current_session_id, archived_at, created_at, updated_at
        FROM campaigns
        WHERE archived_at IS NOT NULL
        ORDER BY archived_at DESC, created_at DESC
        """;

    var campaigns = new List<CampaignDto>();
    await using var cmd = db.CreateCommand(sql);
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        campaigns.Add(ReadCampaign(reader));
    }

    return Results.Ok(campaigns);
});

app.MapPost("/api/campaigns", async (CreateCampaignRequest request, NpgsqlDataSource db) =>
{
    if (string.IsNullOrWhiteSpace(request.Name))
    {
        return Results.BadRequest(new { error = "Campaign name is required." });
    }

    const string sql = """
        INSERT INTO campaigns (name, description, system_tone)
        VALUES (@name, @description, @systemTone)
        RETURNING id, name, description, system_tone, current_session_id, archived_at, created_at, updated_at
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("name", request.Name.Trim());
    cmd.Parameters.AddWithValue("description", (object?)request.Description ?? DBNull.Value);
    cmd.Parameters.AddWithValue("systemTone", string.IsNullOrWhiteSpace(request.SystemTone)
        ? "Helpful, cinematic, rules-aware, and concise."
        : request.SystemTone.Trim());

    await using var reader = await cmd.ExecuteReaderAsync();
    await reader.ReadAsync();
    return Results.Created($"/api/campaigns/{reader.GetGuid(0)}", ReadCampaign(reader));
});

app.MapGet("/api/campaigns/{campaignId:guid}", async (Guid campaignId, NpgsqlDataSource db) =>
{
    // Detail reads include archived campaigns so bookmarked/restored campaign references can still resolve.
    const string sql = """
        SELECT id, name, description, system_tone, current_session_id, archived_at, created_at, updated_at
        FROM campaigns
        WHERE id = @id
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("id", campaignId);
    await using var reader = await cmd.ExecuteReaderAsync();
    return await reader.ReadAsync() ? Results.Ok(ReadCampaign(reader)) : Results.NotFound();
});

app.MapPut("/api/campaigns/{campaignId:guid}", async (Guid campaignId, UpdateCampaignRequest request, NpgsqlDataSource db) =>
{
    const string sql = """
        UPDATE campaigns
        SET name = COALESCE(NULLIF(@name, ''), name),
            description = @description,
            system_tone = COALESCE(NULLIF(@systemTone, ''), system_tone)
        WHERE id = @id
          AND archived_at IS NULL
        RETURNING id, name, description, system_tone, current_session_id, archived_at, created_at, updated_at
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("id", campaignId);
    cmd.Parameters.AddWithValue("name", request.Name?.Trim() ?? string.Empty);
    cmd.Parameters.AddWithValue("description", (object?)request.Description ?? DBNull.Value);
    cmd.Parameters.AddWithValue("systemTone", request.SystemTone?.Trim() ?? string.Empty);

    await using var reader = await cmd.ExecuteReaderAsync();
    return await reader.ReadAsync() ? Results.Ok(ReadCampaign(reader)) : Results.NotFound();
});

app.MapPost("/api/campaigns/{campaignId:guid}/archive", async (Guid campaignId, NpgsqlDataSource db) =>
{
    const string sql = """
        UPDATE campaigns
        SET archived_at = now(),
            updated_at = now()
        WHERE id = @id
          AND archived_at IS NULL
        RETURNING id, name, description, system_tone, current_session_id, archived_at, created_at, updated_at
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("id", campaignId);
    await using var reader = await cmd.ExecuteReaderAsync();
    return await reader.ReadAsync() ? Results.Ok(ReadCampaign(reader)) : Results.NotFound(new { error = "Campaign not found." });
});

app.MapPost("/api/campaigns/{campaignId:guid}/restore", async (Guid campaignId, NpgsqlDataSource db) =>
{
    const string sql = """
        UPDATE campaigns
        SET archived_at = NULL,
            updated_at = now()
        WHERE id = @id
          AND archived_at IS NOT NULL
        RETURNING id, name, description, system_tone, current_session_id, archived_at, created_at, updated_at
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("id", campaignId);
    await using var reader = await cmd.ExecuteReaderAsync();
    return await reader.ReadAsync() ? Results.Ok(ReadCampaign(reader)) : Results.NotFound(new { error = "Campaign not found." });
});

app.MapGet("/api/campaigns/{campaignId:guid}/party", async (Guid campaignId, NpgsqlDataSource db) =>
{
    if (await LoadCampaign(campaignId, db) is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }

    const string sql = """
        SELECT id, campaign_id, name, class_name, race, level, hp_current, hp_max, temp_hp,
               armor_class, initiative_modifier, passive_perception, conditions, notes, created_at, updated_at
        FROM party_characters
        WHERE campaign_id = @campaignId
          AND archived_at IS NULL
        ORDER BY created_at ASC
        """;

    var party = new List<PartyCharacterDto>();
    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        party.Add(ReadPartyCharacter(reader));
    }

    return Results.Ok(party);
});

app.MapPost("/api/campaigns/{campaignId:guid}/party", async (Guid campaignId, CreatePartyCharacterRequest request, NpgsqlDataSource db) =>
{
    if (string.IsNullOrWhiteSpace(request.Name))
    {
        return Results.BadRequest(new { error = "Character name is required." });
    }
    if (await LoadCampaign(campaignId, db) is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }
    var validationError = ValidatePartyCharacterInput(Math.Max(1, request.Level), request.HpCurrent, request.HpMax, request.TempHp);
    if (validationError is not null)
    {
        return Results.BadRequest(new { error = validationError });
    }

    const string sql = """
        INSERT INTO party_characters
          (campaign_id, name, class_name, race, level, hp_current, hp_max, temp_hp,
           armor_class, initiative_modifier, passive_perception, conditions, notes)
        VALUES
          (@campaignId, @name, @className, @race, @level, @hpCurrent, @hpMax, @tempHp,
           @armorClass, @initiativeModifier, @passivePerception, @conditions, @notes)
        RETURNING id, campaign_id, name, class_name, race, level, hp_current, hp_max, temp_hp,
                  armor_class, initiative_modifier, passive_perception, conditions, notes, created_at, updated_at
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("name", request.Name.Trim());
    AddPartyCharacterParameters(cmd, request);

    await using var reader = await cmd.ExecuteReaderAsync();
    await reader.ReadAsync();
    var character = ReadPartyCharacter(reader);
    await reader.DisposeAsync();
    await InsertPartyEvent(db, character.CampaignId, character.Id, "created", "Character created", null, null, character, null);
    return Results.Created($"/api/party/{character.Id}", character);
});

app.MapGet("/api/party/{characterId:guid}", async (Guid characterId, NpgsqlDataSource db) =>
{
    var character = await LoadPartyCharacter(characterId, db);
    return character is null ? Results.NotFound() : Results.Ok(character);
});

app.MapPut("/api/party/{characterId:guid}", async (Guid characterId, UpdatePartyCharacterRequest request, NpgsqlDataSource db) =>
{
    if (string.IsNullOrWhiteSpace(request.Name))
    {
        return Results.BadRequest(new { error = "Character name is required." });
    }

    var before = await LoadPartyCharacter(characterId, db);
    if (before is null)
    {
        return Results.NotFound(new { error = "Character not found." });
    }

    var validationError = ValidatePartyCharacterInput(request.Level, request.HpCurrent, request.HpMax, request.TempHp);
    if (validationError is not null)
    {
        return Results.BadRequest(new { error = validationError });
    }

    const string sql = """
        UPDATE party_characters
        SET name = @name,
            class_name = @className,
            race = @race,
            level = @level,
            hp_current = @hpCurrent,
            hp_max = @hpMax,
            temp_hp = @tempHp,
            armor_class = @armorClass,
            initiative_modifier = @initiativeModifier,
            passive_perception = @passivePerception,
            conditions = @conditions,
            notes = @notes,
            updated_at = now()
        WHERE id = @characterId
          AND archived_at IS NULL
        RETURNING id, campaign_id, name, class_name, race, level, hp_current, hp_max, temp_hp,
                  armor_class, initiative_modifier, passive_perception, conditions, notes, created_at, updated_at
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("characterId", characterId);
    cmd.Parameters.AddWithValue("name", request.Name.Trim());
    AddPartyCharacterParameters(cmd, request);

    await using var reader = await cmd.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return Results.NotFound(new { error = "Character not found." });
    }

    var after = ReadPartyCharacter(reader);
    await reader.DisposeAsync();
    var eventType = before.Level != after.Level ? "level_up" : "updated";
    await InsertPartyEvent(db, after.CampaignId, after.Id, eventType, BuildPartyUpdateTitle(before, after), request.Notes, before, after, null);
    return Results.Ok(after);
});

app.MapDelete("/api/party/{characterId:guid}", async (Guid characterId, NpgsqlDataSource db) =>
{
    var before = await LoadPartyCharacter(characterId, db);
    if (before is null)
    {
        return Results.NotFound(new { error = "Character not found." });
    }

    const string sql = """
        UPDATE party_characters
        SET archived_at = now(), updated_at = now()
        WHERE id = @characterId
          AND archived_at IS NULL
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("characterId", characterId);
    var updated = await cmd.ExecuteNonQueryAsync();
    if (updated == 0)
    {
        return Results.NotFound(new { error = "Character not found." });
    }

    await InsertPartyEvent(db, before.CampaignId, before.Id, "deleted", "Character archived", null, before, null, null);
    return Results.NoContent();
});

app.MapPatch("/api/party/{characterId:guid}/hp", async (Guid characterId, UpdatePartyHpRequest request, NpgsqlDataSource db) =>
{
    var before = await LoadPartyCharacter(characterId, db);
    if (before is null)
    {
        return Results.NotFound(new { error = "Character not found." });
    }

    var hpMax = before.HpMax;
    var validationError = ValidatePartyCharacterInput(before.Level, request.HpCurrent, hpMax, request.TempHp);
    if (validationError is not null)
    {
        return Results.BadRequest(new { error = validationError });
    }

    const string sql = """
        UPDATE party_characters
        SET hp_current = @hpCurrent,
            temp_hp = @tempHp,
            updated_at = now()
        WHERE id = @characterId
          AND archived_at IS NULL
        RETURNING id, campaign_id, name, class_name, race, level, hp_current, hp_max, temp_hp,
                  armor_class, initiative_modifier, passive_perception, conditions, notes, created_at, updated_at
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("characterId", characterId);
    cmd.Parameters.AddWithValue("hpCurrent", (object?)request.HpCurrent ?? DBNull.Value);
    cmd.Parameters.AddWithValue("tempHp", (object?)request.TempHp ?? DBNull.Value);
    await using var reader = await cmd.ExecuteReaderAsync();
    await reader.ReadAsync();
    var after = ReadPartyCharacter(reader);
    await reader.DisposeAsync();
    await InsertPartyEvent(db, after.CampaignId, after.Id, "hp_changed", "HP updated", request.Note, before, after, null);
    return Results.Ok(after);
});

app.MapPatch("/api/party/{characterId:guid}/level", async (Guid characterId, UpdatePartyLevelRequest request, NpgsqlDataSource db) =>
{
    var before = await LoadPartyCharacter(characterId, db);
    if (before is null)
    {
        return Results.NotFound(new { error = "Character not found." });
    }
    if (request.Level < 1)
    {
        return Results.BadRequest(new { error = "Level must be at least 1." });
    }

    const string sql = """
        UPDATE party_characters
        SET level = @level,
            updated_at = now()
        WHERE id = @characterId
          AND archived_at IS NULL
        RETURNING id, campaign_id, name, class_name, race, level, hp_current, hp_max, temp_hp,
                  armor_class, initiative_modifier, passive_perception, conditions, notes, created_at, updated_at
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("characterId", characterId);
    cmd.Parameters.AddWithValue("level", request.Level);
    await using var reader = await cmd.ExecuteReaderAsync();
    await reader.ReadAsync();
    var after = ReadPartyCharacter(reader);
    await reader.DisposeAsync();
    await InsertPartyEvent(db, after.CampaignId, after.Id, "level_up", $"Level changed to {after.Level}", request.Note, before, after, null);
    return Results.Ok(after);
});

app.MapPost("/api/party/{characterId:guid}/events", async (Guid characterId, CreatePartyEventRequest request, NpgsqlDataSource db) =>
{
    var character = await LoadPartyCharacter(characterId, db);
    if (character is null)
    {
        return Results.NotFound(new { error = "Character not found." });
    }
    if (string.IsNullOrWhiteSpace(request.EventType))
    {
        return Results.BadRequest(new { error = "eventType is required." });
    }

    var partyEvent = await InsertPartyEvent(
        db,
        character.CampaignId,
        character.Id,
        request.EventType.Trim(),
        request.Title?.Trim(),
        request.Description?.Trim(),
        null,
        character,
        request.SessionId);
    return Results.Created($"/api/party/{characterId}/events/{partyEvent.Id}", partyEvent);
});

app.MapGet("/api/party/{characterId:guid}/events", async (Guid characterId, NpgsqlDataSource db) =>
{
    var character = await LoadPartyCharacter(characterId, db);
    if (character is null)
    {
        return Results.NotFound(new { error = "Character not found." });
    }

    var events = await LoadPartyEvents("""
        SELECT id, campaign_id, character_id, event_type, title, description, before_state, after_state, session_id, created_at
        FROM party_character_events
        WHERE character_id = @characterId
        ORDER BY created_at DESC
        LIMIT 50
        """, db, command => command.Parameters.AddWithValue("characterId", characterId));
    return Results.Ok(events);
});

app.MapGet("/api/campaigns/{campaignId:guid}/party/events", async (Guid campaignId, NpgsqlDataSource db) =>
{
    if (await LoadCampaign(campaignId, db) is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }

    var events = await LoadPartyEvents("""
        SELECT id, campaign_id, character_id, event_type, title, description, before_state, after_state, session_id, created_at
        FROM party_character_events
        WHERE campaign_id = @campaignId
        ORDER BY created_at DESC
        LIMIT 50
        """, db, command => command.Parameters.AddWithValue("campaignId", campaignId));
    return Results.Ok(events);
});

app.MapGet("/api/campaigns/{campaignId:guid}/sessions", async (Guid campaignId, NpgsqlDataSource db, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }

    await EnsureDemoClientSeed(db, campaignId, clientOwnerId, demoCampaignId, DemoClientOwnerId);

    const string sql = """
        SELECT id, campaign_id, session_number, title, raw_notes, summary, status, created_at, updated_at
        FROM sessions
        WHERE campaign_id = @campaignId
          AND client_owner_id = @clientOwnerId
        ORDER BY session_number DESC, created_at DESC
        """;

    var sessions = new List<SessionDto>();
    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        sessions.Add(ReadSession(reader));
    }

    return Results.Ok(sessions);
});

app.MapPost("/api/campaigns/{campaignId:guid}/sessions", async (Guid campaignId, UpsertSessionRequest request, NpgsqlDataSource db, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }

    var campaign = await LoadCampaign(campaignId, db);
    if (campaign is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }

    const string nextSessionSql = """
        SELECT COALESCE(MAX(session_number), 0) + 1
        FROM sessions
        WHERE campaign_id = @campaignId
          AND client_owner_id = @clientOwnerId
        """;
    await using var nextCmd = db.CreateCommand(nextSessionSql);
    nextCmd.Parameters.AddWithValue("campaignId", campaignId);
    nextCmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    var nextSessionNumber = (int)(await nextCmd.ExecuteScalarAsync() ?? 1);

    const string sql = """
        INSERT INTO sessions (campaign_id, client_owner_id, visibility, session_number, title, raw_notes, summary, status)
        VALUES (@campaignId, @clientOwnerId, 'private', @sessionNumber, @title, @rawNotes, @summary, @status)
        RETURNING id, campaign_id, session_number, title, raw_notes, summary, status, created_at, updated_at
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    cmd.Parameters.AddWithValue("sessionNumber", request.SessionNumber > 0 ? request.SessionNumber : nextSessionNumber);
    cmd.Parameters.AddWithValue("title", string.IsNullOrWhiteSpace(request.Title) ? $"Session {nextSessionNumber}" : request.Title.Trim());
    cmd.Parameters.AddWithValue("rawNotes", (object?)request.RawNotes ?? DBNull.Value);
    cmd.Parameters.AddWithValue("summary", (object?)request.Summary ?? DBNull.Value);
    cmd.Parameters.AddWithValue("status", string.IsNullOrWhiteSpace(request.Status) ? "active" : request.Status.Trim());

    await using var reader = await cmd.ExecuteReaderAsync();
    await reader.ReadAsync();
    return Results.Created($"/api/sessions/{reader.GetGuid(0)}", ReadSession(reader));
});

app.MapGet("/api/sessions/{sessionId:guid}", async (Guid sessionId, NpgsqlDataSource db, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }

    var session = await LoadSession(sessionId, clientOwnerId, db);
    return session is null ? Results.NotFound() : Results.Ok(session);
});

app.MapPut("/api/sessions/{sessionId:guid}", async (Guid sessionId, UpsertSessionRequest request, NpgsqlDataSource db, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }

    const string sql = """
        UPDATE sessions
        SET session_number = CASE WHEN @sessionNumber > 0 THEN @sessionNumber ELSE session_number END,
            title = COALESCE(NULLIF(@title, ''), title),
            raw_notes = @rawNotes,
            summary = @summary,
            status = COALESCE(NULLIF(@status, ''), status),
            updated_at = now()
        WHERE id = @sessionId
          AND client_owner_id = @clientOwnerId
          AND EXISTS (
            SELECT 1 FROM campaigns c
            WHERE c.id = sessions.campaign_id
              AND c.archived_at IS NULL
          )
        RETURNING id, campaign_id, session_number, title, raw_notes, summary, status, created_at, updated_at
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("sessionId", sessionId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    cmd.Parameters.AddWithValue("sessionNumber", request.SessionNumber);
    cmd.Parameters.AddWithValue("title", request.Title?.Trim() ?? string.Empty);
    cmd.Parameters.AddWithValue("rawNotes", (object?)request.RawNotes ?? DBNull.Value);
    cmd.Parameters.AddWithValue("summary", (object?)request.Summary ?? DBNull.Value);
    cmd.Parameters.AddWithValue("status", request.Status?.Trim() ?? string.Empty);

    await using var reader = await cmd.ExecuteReaderAsync();
    return await reader.ReadAsync() ? Results.Ok(ReadSession(reader)) : Results.NotFound();
});

app.MapDelete("/api/sessions/{sessionId:guid}", async (Guid sessionId, NpgsqlDataSource db, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }

    const string sql = """
        DELETE FROM sessions
        WHERE id = @sessionId
          AND client_owner_id = @clientOwnerId
          AND EXISTS (
            SELECT 1 FROM campaigns c
            WHERE c.id = sessions.campaign_id
              AND c.archived_at IS NULL
          )
        """;
    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("sessionId", sessionId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    var deleted = await cmd.ExecuteNonQueryAsync();
    return deleted > 0 ? Results.NoContent() : Results.NotFound();
});

app.MapPost("/api/sessions/{sessionId:guid}/summarize", async (Guid sessionId, NpgsqlDataSource db, IHttpClientFactory httpClientFactory, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }

    var session = await LoadSession(sessionId, clientOwnerId, db);
    if (session is null)
    {
        return Results.NotFound(new { error = "Session not found." });
    }
    if (await LoadCampaign(session.CampaignId, db) is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }
    if (string.IsNullOrWhiteSpace(session.RawNotes))
    {
        return Results.BadRequest(new { error = "Session raw notes are required before summarizing." });
    }

    var client = httpClientFactory.CreateClient("ai-worker");
    var workerResponse = await client.PostAsJsonAsync("/ai/summarize-session", new AiWorkerSummarizeSessionRequest(
        session.CampaignId,
        session.Id,
        session.SessionNumber,
        session.Title,
        session.RawNotes ?? string.Empty));

    if (!workerResponse.IsSuccessStatusCode)
    {
        var error = await workerResponse.Content.ReadAsStringAsync();
        return Results.Problem(FriendlyWorkerError("AI session summary failed", error), statusCode: 502);
    }

    var summary = await workerResponse.Content.ReadFromJsonAsync<SessionSummaryResponse>();
    if (summary is null)
    {
        return Results.Problem("DNDMind could not create a session summary just now. Please try again in a moment.", statusCode: 502);
    }

    await SaveSessionMemory(session, summary, clientOwnerId, db);
    var document = await CreateMemoryDocument(session, summary, clientOwnerId, db);
    var ingestResponse = await client.PostAsJsonAsync("/ai/ingest-document", new AiWorkerIngestDocumentRequest(
        document.Id,
        document.CampaignId,
        document.SourceType,
        document.Title,
        document.Content ?? string.Empty,
        document.Metadata,
        clientOwnerId));

    if (!ingestResponse.IsSuccessStatusCode)
    {
        var error = await ingestResponse.Content.ReadAsStringAsync();
        return Results.Problem(FriendlyWorkerError("AI memory ingestion failed", error), statusCode: 502);
    }

    var refreshedSession = await LoadSession(sessionId, clientOwnerId, db);
    return Results.Ok(new
    {
        session = refreshedSession,
        summary,
        memoryDocumentId = document.Id
    });
});

app.MapGet("/api/campaigns/{campaignId:guid}/memory", async (Guid campaignId, NpgsqlDataSource db, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }

    await EnsureDemoClientSeed(db, campaignId, clientOwnerId, demoCampaignId, DemoClientOwnerId);

    var npcs = await LoadMemoryRows<NpcDto>(db, """
        SELECT id, campaign_id, name, role, description, disposition, last_seen_session_id, metadata, created_at, updated_at
        FROM npcs WHERE campaign_id = @campaignId AND client_owner_id = @clientOwnerId ORDER BY updated_at DESC, name
        """, campaignId, clientOwnerId, ReadNpc);
    var quests = await LoadMemoryRows<QuestDto>(db, """
        SELECT id, campaign_id, title, status, description, last_seen_session_id, metadata, created_at, updated_at
        FROM quests WHERE campaign_id = @campaignId AND client_owner_id = @clientOwnerId ORDER BY updated_at DESC, title
        """, campaignId, clientOwnerId, ReadQuest);
    var locations = await LoadMemoryRows<LocationDto>(db, """
        SELECT id, campaign_id, name, description, location_type, last_seen_session_id, metadata, created_at, updated_at
        FROM locations WHERE campaign_id = @campaignId AND client_owner_id = @clientOwnerId ORDER BY updated_at DESC, name
        """, campaignId, clientOwnerId, ReadLocation);
    var encounters = await LoadMemoryRows<EncounterDto>(db, """
        SELECT id, campaign_id, session_id, title, summary, outcome, metadata, created_at
        FROM encounters WHERE campaign_id = @campaignId AND client_owner_id = @clientOwnerId ORDER BY created_at DESC, title
        """, campaignId, clientOwnerId, ReadEncounter);
    var events = await LoadMemoryRows<MemoryEventDto>(db, """
        SELECT id, campaign_id, session_id, event_type, title, description, metadata, created_at
        FROM memory_events WHERE campaign_id = @campaignId AND client_owner_id = @clientOwnerId ORDER BY created_at DESC LIMIT 50
        """, campaignId, clientOwnerId, ReadMemoryEvent);
    var hooks = await LoadMemoryRows<HookDto>(db, """
        SELECT id, campaign_id, session_id, title, description, status, resolution, related_entity_type, related_entity_name, metadata, created_at, updated_at
        FROM hooks WHERE campaign_id = @campaignId AND client_owner_id = @clientOwnerId ORDER BY updated_at DESC, created_at DESC, title
        """, campaignId, clientOwnerId, ReadHook);

    return Results.Ok(new CampaignMemoryDto(npcs, quests, locations, encounters, events, hooks));
});

app.MapPost("/api/campaigns/{campaignId:guid}/npcs", async (Guid campaignId, SaveNpcRequest request, NpgsqlDataSource db, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }

    if (string.IsNullOrWhiteSpace(request.Name))
    {
        return Results.BadRequest(new { error = "NPC name is required." });
    }
    if (await LoadCampaign(campaignId, db) is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }

    const string sql = """
        INSERT INTO npcs (campaign_id, client_owner_id, name, role, description, disposition, metadata)
        VALUES (@campaignId, @clientOwnerId, @name, @role, @description, @disposition, @metadata)
        ON CONFLICT (campaign_id, client_owner_id, name) DO UPDATE
        SET role = COALESCE(EXCLUDED.role, npcs.role),
            description = COALESCE(EXCLUDED.description, npcs.description),
            disposition = COALESCE(EXCLUDED.disposition, npcs.disposition),
            metadata = npcs.metadata || EXCLUDED.metadata
        RETURNING id, campaign_id, name, role, description, disposition, last_seen_session_id, metadata, created_at, updated_at
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    cmd.Parameters.AddWithValue("name", request.Name.Trim());
    cmd.Parameters.AddWithValue("role", (object?)request.Role?.Trim() ?? DBNull.Value);
    cmd.Parameters.AddWithValue("description", (object?)request.Description?.Trim() ?? DBNull.Value);
    cmd.Parameters.AddWithValue("disposition", (object?)request.RelationshipToParty?.Trim() ?? DBNull.Value);
    cmd.Parameters.Add(new NpgsqlParameter("metadata", NpgsqlDbType.Jsonb)
    {
        Value = JsonSerializer.Serialize(BuildStructuredMetadata(
            clientOwnerId,
            new Dictionary<string, object?>
            {
                ["RaceOrSpecies"] = request.RaceOrSpecies,
                ["Personality"] = request.Personality,
                ["Motivation"] = request.Motivation,
                ["Secret"] = request.Secret,
                ["QuestHook"] = request.QuestHook
            },
            request.Image,
            "npc"))
    });

    await using var reader = await cmd.ExecuteReaderAsync();
    await reader.ReadAsync();
    var npc = ReadNpc(reader);
    return Results.Ok(new { id = npc.Id, npc });
});

app.MapPost("/api/campaigns/{campaignId:guid}/quests", async (Guid campaignId, SaveQuestRequest request, NpgsqlDataSource db, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }

    if (string.IsNullOrWhiteSpace(request.Title))
    {
        return Results.BadRequest(new { error = "Quest title is required." });
    }
    if (await LoadCampaign(campaignId, db) is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }

    const string sql = """
        INSERT INTO quests (campaign_id, client_owner_id, title, status, description, metadata)
        VALUES (@campaignId, @clientOwnerId, @title, @status, @description, @metadata)
        ON CONFLICT (campaign_id, client_owner_id, title) DO UPDATE
        SET status = EXCLUDED.status,
            description = COALESCE(EXCLUDED.description, quests.description),
            metadata = quests.metadata || EXCLUDED.metadata
        RETURNING id, campaign_id, title, status, description, last_seen_session_id, metadata, created_at, updated_at
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    cmd.Parameters.AddWithValue("title", request.Title.Trim());
    cmd.Parameters.AddWithValue("status", string.IsNullOrWhiteSpace(request.Status) ? "open" : request.Status.Trim());
    cmd.Parameters.AddWithValue("description", (object?)request.Description?.Trim() ?? DBNull.Value);
    cmd.Parameters.Add(new NpgsqlParameter("metadata", NpgsqlDbType.Jsonb)
    {
        Value = JsonSerializer.Serialize(new
        {
            source = "structured_output",
            clientOwnerId,
            request.RelatedNpcs,
            request.Objectives,
            request.Reward,
            request.UnresolvedHooks
        })
    });

    await using var reader = await cmd.ExecuteReaderAsync();
    await reader.ReadAsync();
    var quest = ReadQuest(reader);
    return Results.Ok(new { id = quest.Id, quest });
});

app.MapPost("/api/campaigns/{campaignId:guid}/locations", async (Guid campaignId, SaveLocationRequest request, NpgsqlDataSource db, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }

    if (string.IsNullOrWhiteSpace(request.Name))
    {
        return Results.BadRequest(new { error = "Location name is required." });
    }
    if (await LoadCampaign(campaignId, db) is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }

    const string sql = """
        INSERT INTO locations (campaign_id, client_owner_id, name, description, location_type, metadata)
        VALUES (@campaignId, @clientOwnerId, @name, @description, @locationType, @metadata)
        ON CONFLICT (campaign_id, client_owner_id, name) DO UPDATE
        SET description = COALESCE(EXCLUDED.description, locations.description),
            location_type = COALESCE(EXCLUDED.location_type, locations.location_type),
            metadata = locations.metadata || EXCLUDED.metadata
        RETURNING id, campaign_id, name, description, location_type, last_seen_session_id, metadata, created_at, updated_at
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    cmd.Parameters.AddWithValue("name", request.Name.Trim());
    cmd.Parameters.AddWithValue("description", (object?)request.Description?.Trim() ?? DBNull.Value);
    cmd.Parameters.AddWithValue("locationType", (object?)request.Type?.Trim() ?? DBNull.Value);
    cmd.Parameters.Add(new NpgsqlParameter("metadata", NpgsqlDbType.Jsonb)
    {
        Value = JsonSerializer.Serialize(new
        {
            source = "structured_output",
            clientOwnerId,
            request.DangerLevel,
            request.Secrets,
            request.NotableNpcs,
            request.QuestHooks
        })
    });

    await using var reader = await cmd.ExecuteReaderAsync();
    await reader.ReadAsync();
    var location = ReadLocation(reader);
    return Results.Ok(new { id = location.Id, location });
});

app.MapPost("/api/campaigns/{campaignId:guid}/memory-events", async (Guid campaignId, SaveMemoryEventRequest request, NpgsqlDataSource db, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }

    if (string.IsNullOrWhiteSpace(request.Title))
    {
        return Results.BadRequest(new { error = "Memory event title is required." });
    }
    if (await LoadCampaign(campaignId, db) is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }
    if (request.SessionId is Guid sessionId)
    {
        await using var sessionCmd = db.CreateCommand("""
            SELECT EXISTS (
                SELECT 1 FROM sessions
                WHERE id = @sessionId
                  AND campaign_id = @campaignId
                  AND client_owner_id = @clientOwnerId
            )
            """);
        sessionCmd.Parameters.AddWithValue("sessionId", sessionId);
        sessionCmd.Parameters.AddWithValue("campaignId", campaignId);
        sessionCmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
        var sessionExists = (bool)(await sessionCmd.ExecuteScalarAsync() ?? false);
        if (!sessionExists)
        {
            return Results.BadRequest(new { error = "sessionId must belong to this campaign and client." });
        }
    }

    var eventType = string.IsNullOrWhiteSpace(request.EventType) ? "unresolved_hook" : request.EventType.Trim();
    if (eventType is not "unresolved_hook" and not "important_event")
    {
        return Results.BadRequest(new { error = "eventType must be unresolved_hook or important_event." });
    }

    const string sql = """
        INSERT INTO memory_events (campaign_id, client_owner_id, session_id, event_type, title, description, metadata)
        VALUES (@campaignId, @clientOwnerId, @sessionId, @eventType, @title, @description, @metadata)
        RETURNING id, campaign_id, session_id, event_type, title, description, metadata, created_at
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    cmd.Parameters.AddWithValue("sessionId", (object?)request.SessionId ?? DBNull.Value);
    cmd.Parameters.AddWithValue("eventType", eventType);
    cmd.Parameters.AddWithValue("title", request.Title.Trim());
    cmd.Parameters.AddWithValue("description", (object?)request.Description?.Trim() ?? DBNull.Value);
    cmd.Parameters.Add(new NpgsqlParameter("metadata", NpgsqlDbType.Jsonb)
    {
        Value = JsonSerializer.Serialize(new
        {
            source = "structured_output",
            clientOwnerId,
            request.RelatedEntityType,
            request.RelatedEntityName
        })
    });

    await using var reader = await cmd.ExecuteReaderAsync();
    await reader.ReadAsync();
    var memoryEvent = ReadMemoryEvent(reader);
    return Results.Ok(new { id = memoryEvent.Id, memoryEvent });
});

app.MapGet("/api/campaigns/{campaignId:guid}/hooks", async (Guid campaignId, NpgsqlDataSource db, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }
    if (await LoadCampaign(campaignId, db) is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }

    var hooks = await LoadMemoryRows<HookDto>(db, """
        SELECT id, campaign_id, session_id, title, description, status, resolution, related_entity_type, related_entity_name, metadata, created_at, updated_at
        FROM hooks WHERE campaign_id = @campaignId AND client_owner_id = @clientOwnerId ORDER BY updated_at DESC, created_at DESC, title
        """, campaignId, clientOwnerId, ReadHook);
    return Results.Ok(hooks);
});

app.MapPost("/api/campaigns/{campaignId:guid}/hooks", async (Guid campaignId, SaveHookRequest request, NpgsqlDataSource db, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }

    if (string.IsNullOrWhiteSpace(request.Title))
    {
        return Results.BadRequest(new { error = "Hook title is required." });
    }
    if (await LoadCampaign(campaignId, db) is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }
    if (request.SessionId is Guid sessionId && !await SessionBelongsToCampaignClient(sessionId, campaignId, clientOwnerId, db))
    {
        return Results.BadRequest(new { error = "sessionId must belong to this campaign and client." });
    }

    var status = NormalizeHookStatus(request.Status);
    if (status is null)
    {
        return Results.BadRequest(new { error = HookStatusError() });
    }

    const string sql = """
        INSERT INTO hooks (campaign_id, client_owner_id, session_id, title, description, status, resolution, related_entity_type, related_entity_name, metadata)
        VALUES (@campaignId, @clientOwnerId, @sessionId, @title, @description, @status, @resolution, @relatedEntityType, @relatedEntityName, @metadata)
        RETURNING id, campaign_id, session_id, title, description, status, resolution, related_entity_type, related_entity_name, metadata, created_at, updated_at
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    cmd.Parameters.AddWithValue("sessionId", (object?)request.SessionId ?? DBNull.Value);
    cmd.Parameters.AddWithValue("title", request.Title.Trim());
    cmd.Parameters.AddWithValue("description", (object?)request.Description?.Trim() ?? DBNull.Value);
    cmd.Parameters.AddWithValue("status", status);
    cmd.Parameters.AddWithValue("resolution", (object?)request.Resolution?.Trim() ?? DBNull.Value);
    cmd.Parameters.AddWithValue("relatedEntityType", (object?)request.RelatedEntityType?.Trim() ?? DBNull.Value);
    cmd.Parameters.AddWithValue("relatedEntityName", (object?)request.RelatedEntityName?.Trim() ?? DBNull.Value);
    cmd.Parameters.Add(new NpgsqlParameter("metadata", NpgsqlDbType.Jsonb)
    {
        Value = JsonSerializer.Serialize(new
        {
            source = "structured_output",
            clientOwnerId
        })
    });

    await using var reader = await cmd.ExecuteReaderAsync();
    await reader.ReadAsync();
    var hook = ReadHook(reader);
    return Results.Ok(new { id = hook.Id, hook });
});

app.MapPatch("/api/campaigns/{campaignId:guid}/hooks/{hookId:guid}", async (Guid campaignId, Guid hookId, UpdateHookRequest request, NpgsqlDataSource db, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }
    if (await LoadCampaign(campaignId, db) is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }
    if (request.SessionId is Guid sessionId && !await SessionBelongsToCampaignClient(sessionId, campaignId, clientOwnerId, db))
    {
        return Results.BadRequest(new { error = "sessionId must belong to this campaign and client." });
    }

    var status = request.Status is null ? null : NormalizeHookStatus(request.Status);
    if (request.Status is not null && status is null)
    {
        return Results.BadRequest(new { error = HookStatusError() });
    }

    const string sql = """
        UPDATE hooks
        SET title = COALESCE(NULLIF(@title, ''), title),
            description = COALESCE(@description, description),
            status = COALESCE(@status, status),
            resolution = COALESCE(@resolution, resolution),
            session_id = COALESCE(@sessionId, session_id),
            related_entity_type = COALESCE(@relatedEntityType, related_entity_type),
            related_entity_name = COALESCE(@relatedEntityName, related_entity_name)
        WHERE id = @hookId
          AND campaign_id = @campaignId
          AND client_owner_id = @clientOwnerId
        RETURNING id, campaign_id, session_id, title, description, status, resolution, related_entity_type, related_entity_name, metadata, created_at, updated_at
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("hookId", hookId);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    cmd.Parameters.AddWithValue("title", (object?)request.Title?.Trim() ?? DBNull.Value);
    cmd.Parameters.AddWithValue("description", (object?)request.Description?.Trim() ?? DBNull.Value);
    cmd.Parameters.AddWithValue("status", (object?)status ?? DBNull.Value);
    cmd.Parameters.AddWithValue("resolution", (object?)request.Resolution?.Trim() ?? DBNull.Value);
    cmd.Parameters.AddWithValue("sessionId", (object?)request.SessionId ?? DBNull.Value);
    cmd.Parameters.AddWithValue("relatedEntityType", (object?)request.RelatedEntityType?.Trim() ?? DBNull.Value);
    cmd.Parameters.AddWithValue("relatedEntityName", (object?)request.RelatedEntityName?.Trim() ?? DBNull.Value);

    await using var reader = await cmd.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return Results.NotFound(new { error = "Hook not found." });
    }

    var hook = ReadHook(reader);
    return Results.Ok(new { id = hook.Id, hook });
});

app.MapPost("/api/campaigns/{campaignId:guid}/hooks/{hookId:guid}/resolve", async (Guid campaignId, Guid hookId, ResolveHookRequest request, NpgsqlDataSource db, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }
    if (await LoadCampaign(campaignId, db) is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }

    const string sql = """
        UPDATE hooks
        SET status = 'resolved',
            resolution = COALESCE(NULLIF(@resolution, ''), resolution)
        WHERE id = @hookId
          AND campaign_id = @campaignId
          AND client_owner_id = @clientOwnerId
        RETURNING id, campaign_id, session_id, title, description, status, resolution, related_entity_type, related_entity_name, metadata, created_at, updated_at
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("hookId", hookId);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    cmd.Parameters.AddWithValue("resolution", (object?)request.Resolution?.Trim() ?? DBNull.Value);
    await using var reader = await cmd.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return Results.NotFound(new { error = "Hook not found." });
    }
    var hook = ReadHook(reader);
    return Results.Ok(new { id = hook.Id, hook });
});

app.MapPost("/api/campaigns/{campaignId:guid}/hooks/{hookId:guid}/drop", async (Guid campaignId, Guid hookId, NpgsqlDataSource db, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }
    if (await LoadCampaign(campaignId, db) is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }

    const string sql = """
        UPDATE hooks
        SET status = 'dropped'
        WHERE id = @hookId
          AND campaign_id = @campaignId
          AND client_owner_id = @clientOwnerId
        RETURNING id, campaign_id, session_id, title, description, status, resolution, related_entity_type, related_entity_name, metadata, created_at, updated_at
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("hookId", hookId);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    await using var reader = await cmd.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return Results.NotFound(new { error = "Hook not found." });
    }
    var hook = ReadHook(reader);
    return Results.Ok(new { id = hook.Id, hook });
});

app.MapDelete("/api/campaigns/{campaignId:guid}/npcs/{npcId:guid}", async (Guid campaignId, Guid npcId, NpgsqlDataSource db, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }
    if (await LoadCampaign(campaignId, db) is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }

    const string sql = """
        DELETE FROM npcs
        WHERE id = @npcId
          AND campaign_id = @campaignId
          AND client_owner_id = @clientOwnerId
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("npcId", npcId);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    var deleted = await cmd.ExecuteNonQueryAsync();
    return deleted > 0 ? Results.NoContent() : Results.NotFound(new { error = "NPC not found." });
});

app.MapDelete("/api/campaigns/{campaignId:guid}/quests/{questId:guid}", async (Guid campaignId, Guid questId, NpgsqlDataSource db, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }
    if (await LoadCampaign(campaignId, db) is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }

    const string sql = """
        DELETE FROM quests
        WHERE id = @questId
          AND campaign_id = @campaignId
          AND client_owner_id = @clientOwnerId
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("questId", questId);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    var deleted = await cmd.ExecuteNonQueryAsync();
    return deleted > 0 ? Results.NoContent() : Results.NotFound(new { error = "Quest not found." });
});

app.MapDelete("/api/campaigns/{campaignId:guid}/locations/{locationId:guid}", async (Guid campaignId, Guid locationId, NpgsqlDataSource db, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }
    if (await LoadCampaign(campaignId, db) is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }

    const string sql = """
        DELETE FROM locations
        WHERE id = @locationId
          AND campaign_id = @campaignId
          AND client_owner_id = @clientOwnerId
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("locationId", locationId);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    var deleted = await cmd.ExecuteNonQueryAsync();
    return deleted > 0 ? Results.NoContent() : Results.NotFound(new { error = "Location not found." });
});

app.MapDelete("/api/campaigns/{campaignId:guid}/memory-events/{eventId:guid}", async (Guid campaignId, Guid eventId, NpgsqlDataSource db, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }
    if (await LoadCampaign(campaignId, db) is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }

    const string sql = """
        DELETE FROM memory_events
        WHERE id = @eventId
          AND campaign_id = @campaignId
          AND client_owner_id = @clientOwnerId
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("eventId", eventId);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    var deleted = await cmd.ExecuteNonQueryAsync();
    return deleted > 0 ? Results.NoContent() : Results.NotFound(new { error = "Memory event not found." });
});

app.MapDelete("/api/campaigns/{campaignId:guid}/hooks/{hookId:guid}", async (Guid campaignId, Guid hookId, NpgsqlDataSource db, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }
    if (await LoadCampaign(campaignId, db) is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }

    const string sql = """
        DELETE FROM hooks
        WHERE id = @hookId
          AND campaign_id = @campaignId
          AND client_owner_id = @clientOwnerId
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("hookId", hookId);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    var deleted = await cmd.ExecuteNonQueryAsync();
    return deleted > 0 ? Results.NoContent() : Results.NotFound(new { error = "Hook not found." });
});

app.MapPost("/api/campaigns/{campaignId:guid}/encounters", async (Guid campaignId, SaveEncounterRequest request, NpgsqlDataSource db, ICurrentClientService currentClient, IHttpClientFactory httpClientFactory) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }

    if (string.IsNullOrWhiteSpace(request.Title))
    {
        return Results.BadRequest(new { error = "Encounter title is required." });
    }
    if (await LoadCampaign(campaignId, db) is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }
    if (request.SessionId is not null)
    {
        var session = await LoadSession(request.SessionId.Value, clientOwnerId, db);
        if (session is null || session.CampaignId != campaignId)
        {
            return Results.BadRequest(new { error = "Session must belong to this campaign and browser profile." });
        }
    }

    const string sql = """
        INSERT INTO encounters (campaign_id, client_owner_id, session_id, title, summary, outcome, metadata)
        VALUES (@campaignId, @clientOwnerId, @sessionId, @title, @summary, NULL, @metadata)
        ON CONFLICT (campaign_id, client_owner_id, title) DO UPDATE
        SET session_id = EXCLUDED.session_id,
            summary = COALESCE(EXCLUDED.summary, encounters.summary),
            metadata = encounters.metadata || EXCLUDED.metadata
        RETURNING id, campaign_id, session_id, title, summary, outcome, metadata, created_at
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    cmd.Parameters.AddWithValue("sessionId", (object?)request.SessionId ?? DBNull.Value);
    cmd.Parameters.AddWithValue("title", request.Title.Trim());
    cmd.Parameters.AddWithValue("summary", (object?)request.Tactics?.Trim() ?? DBNull.Value);
    cmd.Parameters.Add(new NpgsqlParameter("metadata", NpgsqlDbType.Jsonb)
    {
        Value = JsonSerializer.Serialize(BuildStructuredMetadata(
            clientOwnerId,
            new Dictionary<string, object?>
            {
                ["Difficulty"] = request.Difficulty,
                ["Environment"] = request.Environment,
                ["Monsters"] = request.Monsters,
                ["ScalingOptions"] = request.ScalingOptions,
                ["Rewards"] = request.Rewards,
                ["CampaignHooks"] = request.CampaignHooks
            },
            request.Image,
            "encounter"))
    });

    EncounterDto encounter;
    await using (var reader = await cmd.ExecuteReaderAsync())
    {
        await reader.ReadAsync();
        encounter = ReadEncounter(reader);
    }

    var document = await CreateEncounterMemoryDocument(encounter, request, clientOwnerId, db);
    var client = httpClientFactory.CreateClient("ai-worker");
    var ingestResponse = await client.PostAsJsonAsync("/ai/ingest-document", new AiWorkerIngestDocumentRequest(
        document.Id,
        document.CampaignId,
        document.SourceType,
        document.Title,
        document.Content ?? string.Empty,
        document.Metadata,
        clientOwnerId));

    if (!ingestResponse.IsSuccessStatusCode)
    {
        var error = await ingestResponse.Content.ReadAsStringAsync();
        return Results.Problem(FriendlyWorkerError("AI encounter memory ingestion failed", error), statusCode: 502);
    }

    return Results.Ok(new { id = encounter.Id, encounter, memoryDocumentId = document.Id });
});

app.MapDelete("/api/campaigns/{campaignId:guid}/encounters/{encounterId:guid}", async (Guid campaignId, Guid encounterId, NpgsqlDataSource db, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }

    if (await LoadCampaign(campaignId, db) is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }

    await using var connection = await db.OpenConnectionAsync();
    await using var transaction = await connection.BeginTransactionAsync();

    const string deleteEncounterSql = """
        DELETE FROM encounters
        WHERE id = @encounterId
          AND campaign_id = @campaignId
          AND client_owner_id = @clientOwnerId
        """;

    await using (var deleteEncounterCmd = new NpgsqlCommand(deleteEncounterSql, connection, transaction))
    {
        deleteEncounterCmd.Parameters.AddWithValue("encounterId", encounterId);
        deleteEncounterCmd.Parameters.AddWithValue("campaignId", campaignId);
        deleteEncounterCmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
        var deleted = await deleteEncounterCmd.ExecuteNonQueryAsync();
        if (deleted == 0)
        {
            return Results.NotFound(new { error = "Encounter not found." });
        }
    }

    const string matchingDocumentsSql = """
        SELECT id
        FROM knowledge_documents
        WHERE campaign_id = @campaignId
          AND source_type = 'campaign_memory'
          AND metadata->>'clientOwnerId' = @clientOwnerId
          AND metadata->>'memoryType' = 'encounter'
          AND metadata->>'encounterId' = @encounterIdText
        """;

    const string deleteChunksSql = $"""
        DELETE FROM knowledge_chunks
        WHERE document_id IN ({matchingDocumentsSql})
        """;

    await using (var deleteChunksCmd = new NpgsqlCommand(deleteChunksSql, connection, transaction))
    {
        deleteChunksCmd.Parameters.AddWithValue("campaignId", campaignId);
        deleteChunksCmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
        deleteChunksCmd.Parameters.AddWithValue("encounterIdText", encounterId.ToString());
        await deleteChunksCmd.ExecuteNonQueryAsync();
    }

    const string deleteDocumentsSql = $"""
        DELETE FROM knowledge_documents
        WHERE id IN ({matchingDocumentsSql})
        """;

    await using (var deleteDocumentsCmd = new NpgsqlCommand(deleteDocumentsSql, connection, transaction))
    {
        deleteDocumentsCmd.Parameters.AddWithValue("campaignId", campaignId);
        deleteDocumentsCmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
        deleteDocumentsCmd.Parameters.AddWithValue("encounterIdText", encounterId.ToString());
        await deleteDocumentsCmd.ExecuteNonQueryAsync();
    }

    await transaction.CommitAsync();
    return Results.NoContent();
});

app.MapPost("/api/campaigns/{campaignId:guid}/documents/upload", async (Guid campaignId, UploadDocumentRequest request, NpgsqlDataSource db) =>
{
    if (!TryPrepareUploadDocument(request, out var upload, out var validationError))
    {
        return Results.BadRequest(new { error = validationError });
    }

    var campaign = await LoadCampaign(campaignId, db);
    if (campaign is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }

    const string sql = """
        INSERT INTO knowledge_documents (campaign_id, source_type, title, original_filename, content, metadata)
        VALUES (@campaignId, @sourceType, @title, @originalFilename, @content, '{"status":"uploaded"}'::jsonb || @metadata)
        RETURNING id, campaign_id, source_type, title, original_filename, content, metadata, created_at,
          (SELECT count(*)::int FROM knowledge_chunks WHERE document_id = knowledge_documents.id) AS chunk_count
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("sourceType", upload.SourceType);
    cmd.Parameters.AddWithValue("title", upload.Title);
    cmd.Parameters.AddWithValue("originalFilename", (object?)upload.OriginalFilename ?? DBNull.Value);
    cmd.Parameters.AddWithValue("content", upload.Content);
    cmd.Parameters.Add(new NpgsqlParameter("metadata", NpgsqlDbType.Jsonb)
    {
        Value = request.Metadata.HasValue ? request.Metadata.Value.GetRawText() : "{}"
    });

    await using var reader = await cmd.ExecuteReaderAsync();
    await reader.ReadAsync();
    return Results.Created($"/api/documents/{reader.GetGuid(0)}", ReadDocument(reader, includeContent: false));
});

app.MapGet("/api/campaigns/{campaignId:guid}/documents", async (Guid campaignId, NpgsqlDataSource db, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }

    const string sql = """
        SELECT kd.id, kd.campaign_id, kd.source_type, kd.title, kd.original_filename, kd.content, kd.metadata, kd.created_at,
          count(kc.id)::int AS chunk_count
        FROM knowledge_documents kd
        LEFT JOIN knowledge_chunks kc ON kc.document_id = kd.id
        WHERE kd.campaign_id = @campaignId
          AND (kd.source_type <> 'campaign_memory' OR kd.metadata->>'clientOwnerId' = @clientOwnerId)
        GROUP BY kd.id
        ORDER BY kd.created_at DESC
        """;

    var documents = new List<DocumentDto>();
    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        documents.Add(ReadDocument(reader, includeContent: false));
    }

    return Results.Ok(documents);
});

app.MapPost("/api/documents/{documentId:guid}/ingest", async (Guid documentId, NpgsqlDataSource db, IHttpClientFactory httpClientFactory, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }

    var document = await LoadDocument(documentId, db);
    if (document is null)
    {
        return Results.NotFound(new { error = "Document not found." });
    }
    if (document.CampaignId is Guid documentCampaignId && await LoadCampaign(documentCampaignId, db) is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }
    if (document.SourceType == "campaign_memory" && !MetadataClientOwnerMatches(document.Metadata, clientOwnerId))
    {
        return Results.NotFound(new { error = "Document not found." });
    }

    var client = httpClientFactory.CreateClient("ai-worker");
    var workerResponse = await client.PostAsJsonAsync("/ai/ingest-document", new AiWorkerIngestDocumentRequest(
        document.Id,
        document.CampaignId,
        document.SourceType,
        document.Title,
        document.Content ?? string.Empty,
        document.Metadata,
        document.SourceType == "campaign_memory" ? clientOwnerId : null));

    if (!workerResponse.IsSuccessStatusCode)
    {
        var error = await workerResponse.Content.ReadAsStringAsync();
        var statusCode = workerResponse.StatusCode == System.Net.HttpStatusCode.BadRequest ? 400 : 502;
        return Results.Problem(FriendlyWorkerError("Campaign knowledge setup failed", error), statusCode: statusCode);
    }

    var result = await workerResponse.Content.ReadFromJsonAsync<IngestDocumentResponse>();
    return Results.Ok(result);
});

app.MapDelete("/api/documents/{documentId:guid}", async (Guid documentId, NpgsqlDataSource db, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out _, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }

    var document = await LoadDocument(documentId, db);
    if (document is null)
    {
        return Results.NotFound(new { error = "Document not found." });
    }
    if (document.CampaignId is Guid documentCampaignId && await LoadCampaign(documentCampaignId, db) is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }

    if (document.SourceType == "campaign_memory")
    {
        return Results.BadRequest(new { error = "Session memory documents cannot be deleted from Campaign Knowledge." });
    }

    const string sql = """
        DELETE FROM knowledge_documents
        WHERE id = @documentId
          AND source_type <> 'campaign_memory'
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("documentId", documentId);
    var deleted = await cmd.ExecuteNonQueryAsync();
    return deleted > 0 ? Results.NoContent() : Results.NotFound(new { error = "Document not found." });
});

app.MapPost("/api/chat", async (ChatRequest request, NpgsqlDataSource db, IHttpClientFactory httpClientFactory, ICurrentClientService currentClient, HttpContext httpContext) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }

    if (request.CampaignId == Guid.Empty || string.IsNullOrWhiteSpace(request.Message))
    {
        return Results.BadRequest(new { error = "campaignId and message are required." });
    }

    var campaign = await LoadCampaign(request.CampaignId, db);
    if (campaign is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }

    if (request.ConversationId is Guid requestedConversationId && !await ConversationBelongsToCampaign(requestedConversationId, request.CampaignId, db))
    {
        return Results.BadRequest(new { error = "conversationId must belong to this campaign." });
    }

    await EnsureDemoClientSeed(db, request.CampaignId, clientOwnerId, demoCampaignId, DemoClientOwnerId);

    SessionDto? session = null;
    if (request.SessionId is Guid sessionId)
    {
        session = await LoadSession(sessionId, clientOwnerId, db);
        if (session is null || session.CampaignId != request.CampaignId)
        {
            return Results.NotFound(new { error = "Session not found." });
        }
    }

    IReadOnlyList<PartyCharacterDto> party = request.Context.UsePartyInfo
        ? await LoadParty(request.CampaignId, db)
        : Array.Empty<PartyCharacterDto>();
    var conversationId = request.ConversationId ?? await CreateConversation(request.CampaignId, request.Message, db);
    await StoreMessage(conversationId, "user", request.Mode, request.Message, new { request.Context }, db);

    var workerRequest = new AiWorkerChatRequest(
        request.CampaignId,
        conversationId,
        request.Message,
        request.Mode,
        clientOwnerId,
        request.Context,
        campaign,
        party,
        session);

    var requestAborted = httpContext.RequestAborted;
    var client = httpClientFactory.CreateClient("ai-worker");
    HttpResponseMessage workerResponse;
    try
    {
        workerResponse = await client.PostAsJsonAsync("/ai/chat", workerRequest, requestAborted);
    }
    catch (OperationCanceledException) when (requestAborted.IsCancellationRequested)
    {
        return Results.StatusCode(499);
    }
    catch (OperationCanceledException)
    {
        return Results.Problem(
            "DNDMind is still waiting on the AI worker. Please try again in a moment, or restart the API and worker if Vertex is stuck.",
            statusCode: StatusCodes.Status504GatewayTimeout);
    }

    if (!workerResponse.IsSuccessStatusCode)
    {
        var error = await workerResponse.Content.ReadAsStringAsync(requestAborted);
        return Results.Problem(FriendlyWorkerError("AI request failed", error), statusCode: 502);
    }

    var chatResponse = await workerResponse.Content.ReadFromJsonAsync<ChatResponse>(cancellationToken: requestAborted);
    if (chatResponse is null)
    {
        return Results.Problem("DNDMind could not get an AI response just now. Please try again in a moment.", statusCode: 502);
    }

    var response = chatResponse with { ConversationId = conversationId };
    await StoreMessage(conversationId, "assistant", response.Mode, response.Answer, new
    {
        response.Citations,
        response.ToolCalls,
        response.StructuredOutput,
        response.SuggestedActions
    }, db);
    await StoreToolCalls(conversationId, response.ToolCalls, db);

    return Results.Ok(response);
});

app.MapPost("/api/campaigns/{campaignId:guid}/recap", async (Guid campaignId, CampaignRecapRequest request, NpgsqlDataSource db, IHttpClientFactory httpClientFactory, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }

    var campaign = await LoadCampaign(campaignId, db);
    if (campaign is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }

    await EnsureDemoClientSeed(db, campaignId, clientOwnerId, demoCampaignId, DemoClientOwnerId);

    SessionDto? session = null;
    if (request.SessionId is Guid sessionId)
    {
        session = await LoadSession(sessionId, clientOwnerId, db);
        if (session is null || session.CampaignId != campaignId)
        {
            return Results.NotFound(new { error = "Session not found." });
        }
    }

    var activeSessionTitle = CompactText(request.ActiveSessionTitle, 200);
    var activeSessionRawNotes = CompactText(request.ActiveSessionRawNotes, 8000);
    var activeSessionSummary = CompactText(request.ActiveSessionSummary, 4000);

    var workerRequest = new AiWorkerCampaignRecapRequest(
        campaignId,
        campaign.Name,
        clientOwnerId,
        string.IsNullOrWhiteSpace(activeSessionTitle) ? session?.Title : activeSessionTitle,
        string.IsNullOrWhiteSpace(activeSessionRawNotes) ? session?.RawNotes : activeSessionRawNotes,
        string.IsNullOrWhiteSpace(activeSessionSummary) ? session?.Summary : activeSessionSummary);

    var client = httpClientFactory.CreateClient("ai-worker");
    var workerResponse = await client.PostAsJsonAsync("/ai/campaign-recap", workerRequest);
    if (!workerResponse.IsSuccessStatusCode)
    {
        var error = await workerResponse.Content.ReadAsStringAsync();
        return Results.Problem(FriendlyWorkerError("AI campaign recap failed", error), statusCode: 502);
    }

    var recapResponse = await workerResponse.Content.ReadFromJsonAsync<CampaignRecapResponse>();
    if (recapResponse is null)
    {
        return Results.Problem("DNDMind could not narrate the campaign recap just now. Please try again in a moment.", statusCode: 502);
    }

    return Results.Ok(recapResponse);
});

app.MapPost("/api/prompt-suggestions", async (PromptSuggestionRequest request, NpgsqlDataSource db, IHttpClientFactory httpClientFactory, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }

    if (request.CampaignId == Guid.Empty)
    {
        return Results.BadRequest(new { error = "campaignId is required." });
    }

    var normalizedMode = NormalizePromptSuggestionMode(request.Mode);
    if (normalizedMode is null)
    {
        return Results.BadRequest(new { error = "mode must be auto, rules, npc, character, encounter, recap, or summarize." });
    }

    var campaign = await LoadCampaign(request.CampaignId, db);
    if (campaign is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }

    await EnsureDemoClientSeed(db, request.CampaignId, clientOwnerId, demoCampaignId, DemoClientOwnerId);

    SessionDto? session = null;
    if (request.SessionId is Guid sessionId)
    {
        session = await LoadSession(sessionId, clientOwnerId, db);
        if (session is null || session.CampaignId != request.CampaignId)
        {
            return Results.NotFound(new { error = "Session not found." });
        }
    }

    var party = await LoadParty(request.CampaignId, db);
    var memory = await LoadCampaignMemory(request.CampaignId, clientOwnerId, db);
    var workerRequest = new AiWorkerPromptSuggestionRequest(
        request.CampaignId,
        request.SessionId,
        normalizedMode,
        request.CurrentInput,
        clientOwnerId,
        campaign,
        party,
        session,
        memory);

    var client = httpClientFactory.CreateClient("ai-worker");
    var workerResponse = await client.PostAsJsonAsync("/prompt-suggestions", workerRequest);
    if (!workerResponse.IsSuccessStatusCode)
    {
        var error = await workerResponse.Content.ReadAsStringAsync();
        return Results.Problem(FriendlyWorkerError("AI prompt suggestion failed", error), statusCode: 502);
    }

    var suggestion = await workerResponse.Content.ReadFromJsonAsync<PromptSuggestionResponse>();
    return suggestion is null
        ? Results.Problem("DNDMind could not draft a prompt suggestion just now. Please try again in a moment.", statusCode: 502)
        : Results.Ok(suggestion);
});

app.MapPost("/api/images/generate", async (ImageGenerationRequest request, NpgsqlDataSource db, IHttpClientFactory httpClientFactory, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }

    if (request.CampaignId == Guid.Empty)
    {
        return Results.BadRequest(new { error = "campaignId is required." });
    }

    var outputType = NormalizeStructuredImageOutputType(request.StructuredOutputType);
    if (outputType is null)
    {
        return Results.BadRequest(new { error = "structuredOutputType must be npc, character, or encounter." });
    }

    var stylePreset = NormalizeImageStylePreset(request.StylePreset);
    if (stylePreset is null || !ImageStylePresetAllowedForOutputType(outputType, stylePreset))
    {
        return Results.BadRequest(new { error = ImageStylePresetErrorMessage(outputType) });
    }

    var campaign = await LoadCampaign(request.CampaignId, db);
    if (campaign is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }

    if (request.ConversationId is Guid conversationId && !await ConversationBelongsToCampaign(conversationId, request.CampaignId, db))
    {
        return Results.BadRequest(new { error = "conversationId must belong to this campaign." });
    }

    var workerRequest = new AiWorkerImageGenerationRequest(
        request.CampaignId,
        request.ConversationId,
        outputType,
        request.StructuredOutputData,
        stylePreset,
        clientOwnerId);

    var client = httpClientFactory.CreateClient("ai-worker");
    var workerResponse = await client.PostAsJsonAsync("/images/generate", workerRequest);
    if (!workerResponse.IsSuccessStatusCode)
    {
        var error = await workerResponse.Content.ReadAsStringAsync();
        return Results.Problem(FriendlyWorkerError("AI image generation failed", error), statusCode: 502);
    }

    var image = await workerResponse.Content.ReadFromJsonAsync<ImageGenerationResponse>();
    return image is null
        ? Results.Problem("DNDMind could not generate an image just now. Please try again in a moment.", statusCode: 502)
        : Results.Ok(image);
});

app.MapPost("/api/tools/execute", async (ToolExecuteRequest request, NpgsqlDataSource db, IHttpClientFactory httpClientFactory, ICurrentClientService currentClient) =>
{
    if (!currentClient.TryGetClientId(out var clientOwnerId, out var clientError))
    {
        return Results.BadRequest(new { error = clientError });
    }

    if (string.IsNullOrWhiteSpace(request.ToolName))
    {
        return Results.BadRequest(new { error = "toolName is required." });
    }
    if (request.CampaignId is Guid toolCampaignId && await LoadCampaign(toolCampaignId, db) is null)
    {
        return Results.NotFound(new { error = "Campaign not found." });
    }

    var conversationScopeValidated = false;
    if (request.ConversationId is Guid toolConversationId && request.CampaignId is Guid toolConversationCampaignId)
    {
        if (!await ConversationBelongsToCampaign(toolConversationId, toolConversationCampaignId, db))
        {
            return Results.BadRequest(new { error = "conversationId must belong to this campaign." });
        }
        conversationScopeValidated = true;
    }

    var client = httpClientFactory.CreateClient("ai-worker");
    var workerResponse = await client.PostAsJsonAsync("/ai/tools/execute", new AiWorkerToolExecuteRequest(
        request.CampaignId,
        request.ConversationId,
        request.ToolName,
        request.Arguments,
        clientOwnerId));
    if (!workerResponse.IsSuccessStatusCode)
    {
        var error = await workerResponse.Content.ReadAsStringAsync();
        return Results.Problem(FriendlyWorkerError("AI tool execution failed", error), statusCode: 502);
    }

    var toolResponse = await workerResponse.Content.ReadFromJsonAsync<ToolExecuteResponse>();
    if (toolResponse is null)
    {
        return Results.Problem("DNDMind could not complete that action just now. Please try again in a moment.", statusCode: 502);
    }

    if (request.ConversationId is not null && conversationScopeValidated)
    {
        await StoreToolCall(request.ConversationId.Value, toolResponse.ToolName, toolResponse.Arguments, toolResponse.Result, toolResponse.Success, toolResponse.Error, db);
    }

    return Results.Ok(toolResponse);
});

app.Run();

static async Task EnsureRagSchema(NpgsqlDataSource db)
{
    const string sql = """
        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE EXTENSION IF NOT EXISTS pgcrypto;

        CREATE OR REPLACE FUNCTION set_updated_at()
        RETURNS trigger AS $$
        BEGIN
          NEW.updated_at = now();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        ALTER TABLE knowledge_documents
        ADD COLUMN IF NOT EXISTS content text NOT NULL DEFAULT '';

        ALTER TABLE campaigns
        ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

        ALTER TABLE sessions
        ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

        ALTER TABLE sessions
        ADD COLUMN IF NOT EXISTS client_owner_id text;

        ALTER TABLE sessions
        ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';

        ALTER TABLE party_characters
        ALTER COLUMN class_name DROP NOT NULL,
        ALTER COLUMN race DROP NOT NULL,
        ALTER COLUMN hp_current DROP NOT NULL,
        ALTER COLUMN hp_max DROP NOT NULL,
        ALTER COLUMN armor_class DROP NOT NULL;

        ALTER TABLE party_characters
        ADD COLUMN IF NOT EXISTS temp_hp int NULL,
        ADD COLUMN IF NOT EXISTS initiative_modifier int NULL,
        ADD COLUMN IF NOT EXISTS passive_perception int NULL,
        ADD COLUMN IF NOT EXISTS conditions text[] NULL,
        ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

        UPDATE sessions
        SET client_owner_id = 'dndmind-demo-client'
        WHERE client_owner_id IS NULL;

        ALTER TABLE sessions
        ALTER COLUMN client_owner_id SET NOT NULL;

        CREATE TABLE IF NOT EXISTS npcs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          client_owner_id text NOT NULL DEFAULT 'dndmind-demo-client',
          name text NOT NULL,
          role text NULL,
          description text NULL,
          disposition text NULL,
          last_seen_session_id uuid NULL REFERENCES sessions(id) ON DELETE SET NULL,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT npcs_campaign_client_owner_name_key UNIQUE (campaign_id, client_owner_id, name)
        );

        CREATE TABLE IF NOT EXISTS quests (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          client_owner_id text NOT NULL DEFAULT 'dndmind-demo-client',
          title text NOT NULL,
          status text NOT NULL DEFAULT 'open',
          description text NULL,
          last_seen_session_id uuid NULL REFERENCES sessions(id) ON DELETE SET NULL,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT quests_campaign_client_owner_title_key UNIQUE (campaign_id, client_owner_id, title)
        );

        CREATE TABLE IF NOT EXISTS locations (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          client_owner_id text NOT NULL DEFAULT 'dndmind-demo-client',
          name text NOT NULL,
          description text NULL,
          location_type text NULL,
          last_seen_session_id uuid NULL REFERENCES sessions(id) ON DELETE SET NULL,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT locations_campaign_client_owner_name_key UNIQUE (campaign_id, client_owner_id, name)
        );

        CREATE TABLE IF NOT EXISTS encounters (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          client_owner_id text NOT NULL DEFAULT 'dndmind-demo-client',
          session_id uuid NULL REFERENCES sessions(id) ON DELETE SET NULL,
          title text NOT NULL,
          summary text NULL,
          outcome text NULL,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT encounters_campaign_client_owner_title_key UNIQUE (campaign_id, client_owner_id, title)
        );

        CREATE TABLE IF NOT EXISTS memory_events (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          client_owner_id text NOT NULL DEFAULT 'dndmind-demo-client',
          session_id uuid NULL REFERENCES sessions(id) ON DELETE SET NULL,
          event_type text NOT NULL,
          title text NOT NULL,
          description text NULL,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS hooks (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          client_owner_id text NOT NULL DEFAULT 'dndmind-demo-client',
          session_id uuid NULL REFERENCES sessions(id) ON DELETE SET NULL,
          title text NOT NULL,
          description text NULL,
          status text NOT NULL DEFAULT 'open',
          resolution text NULL,
          related_entity_type text NULL,
          related_entity_name text NULL,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT hooks_status_check CHECK (status IN ('open', 'rumor', 'lead', 'active', 'resolved', 'dropped'))
        );

        CREATE TABLE IF NOT EXISTS party_character_events (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          character_id uuid NOT NULL REFERENCES party_characters(id) ON DELETE CASCADE,
          event_type text NOT NULL,
          title text NULL,
          description text NULL,
          before_state jsonb NULL,
          after_state jsonb NULL,
          session_id uuid NULL REFERENCES sessions(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );

        ALTER TABLE npcs ADD COLUMN IF NOT EXISTS client_owner_id text;
        ALTER TABLE quests ADD COLUMN IF NOT EXISTS client_owner_id text;
        ALTER TABLE locations ADD COLUMN IF NOT EXISTS client_owner_id text;
        ALTER TABLE encounters ADD COLUMN IF NOT EXISTS client_owner_id text;
        ALTER TABLE memory_events ADD COLUMN IF NOT EXISTS client_owner_id text;

        UPDATE npcs SET client_owner_id = 'dndmind-demo-client' WHERE client_owner_id IS NULL;
        UPDATE quests SET client_owner_id = 'dndmind-demo-client' WHERE client_owner_id IS NULL;
        UPDATE locations SET client_owner_id = 'dndmind-demo-client' WHERE client_owner_id IS NULL;
        UPDATE encounters SET client_owner_id = 'dndmind-demo-client' WHERE client_owner_id IS NULL;
        UPDATE memory_events SET client_owner_id = 'dndmind-demo-client' WHERE client_owner_id IS NULL;

        ALTER TABLE npcs ALTER COLUMN client_owner_id SET DEFAULT 'dndmind-demo-client', ALTER COLUMN client_owner_id SET NOT NULL;
        ALTER TABLE quests ALTER COLUMN client_owner_id SET DEFAULT 'dndmind-demo-client', ALTER COLUMN client_owner_id SET NOT NULL;
        ALTER TABLE locations ALTER COLUMN client_owner_id SET DEFAULT 'dndmind-demo-client', ALTER COLUMN client_owner_id SET NOT NULL;
        ALTER TABLE encounters ALTER COLUMN client_owner_id SET DEFAULT 'dndmind-demo-client', ALTER COLUMN client_owner_id SET NOT NULL;
        ALTER TABLE memory_events ALTER COLUMN client_owner_id SET DEFAULT 'dndmind-demo-client', ALTER COLUMN client_owner_id SET NOT NULL;

        ALTER TABLE npcs DROP CONSTRAINT IF EXISTS npcs_campaign_id_name_key;
        ALTER TABLE quests DROP CONSTRAINT IF EXISTS quests_campaign_id_title_key;
        ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_campaign_id_name_key;

        WITH duplicate_encounters AS (
          SELECT id,
            row_number() OVER (
              PARTITION BY campaign_id, client_owner_id, title
              ORDER BY (metadata->>'source' = 'structured_output') DESC, created_at DESC, id DESC
            ) AS row_number
          FROM encounters
        )
        DELETE FROM encounters
        WHERE id IN (SELECT id FROM duplicate_encounters WHERE row_number > 1);

        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'npcs_campaign_client_owner_name_key') THEN
            ALTER TABLE npcs ADD CONSTRAINT npcs_campaign_client_owner_name_key UNIQUE (campaign_id, client_owner_id, name);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quests_campaign_client_owner_title_key') THEN
            ALTER TABLE quests ADD CONSTRAINT quests_campaign_client_owner_title_key UNIQUE (campaign_id, client_owner_id, title);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'locations_campaign_client_owner_name_key') THEN
            ALTER TABLE locations ADD CONSTRAINT locations_campaign_client_owner_name_key UNIQUE (campaign_id, client_owner_id, name);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'encounters_campaign_client_owner_title_key') THEN
            ALTER TABLE encounters ADD CONSTRAINT encounters_campaign_client_owner_title_key UNIQUE (campaign_id, client_owner_id, title);
          END IF;
        END $$;

        CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document_id
          ON knowledge_chunks(document_id);

        CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding_cosine
          ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops)
          WITH (lists = 32)
          WHERE embedding IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_campaigns_archived_at ON campaigns(archived_at);
        CREATE INDEX IF NOT EXISTS idx_npcs_campaign_id ON npcs(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_quests_campaign_id ON quests(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_locations_campaign_id ON locations(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_encounters_campaign_id ON encounters(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_memory_events_campaign_id ON memory_events(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_hooks_campaign_id ON hooks(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_party_characters_campaign_id ON party_characters(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_party_character_events_campaign_id ON party_character_events(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_party_character_events_character_id ON party_character_events(character_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_campaign_client_owner ON sessions(campaign_id, client_owner_id);
        CREATE INDEX IF NOT EXISTS idx_npcs_campaign_client_owner ON npcs(campaign_id, client_owner_id);
        CREATE INDEX IF NOT EXISTS idx_quests_campaign_client_owner ON quests(campaign_id, client_owner_id);
        CREATE INDEX IF NOT EXISTS idx_locations_campaign_client_owner ON locations(campaign_id, client_owner_id);
        CREATE INDEX IF NOT EXISTS idx_encounters_campaign_client_owner ON encounters(campaign_id, client_owner_id);
        CREATE INDEX IF NOT EXISTS idx_memory_events_campaign_client_owner ON memory_events(campaign_id, client_owner_id);
        CREATE INDEX IF NOT EXISTS idx_hooks_campaign_client_owner ON hooks(campaign_id, client_owner_id, status);

        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sessions_updated_at') THEN
            CREATE TRIGGER sessions_updated_at BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'party_characters_updated_at') THEN
            CREATE TRIGGER party_characters_updated_at BEFORE UPDATE ON party_characters FOR EACH ROW EXECUTE FUNCTION set_updated_at();
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'npcs_updated_at') THEN
            CREATE TRIGGER npcs_updated_at BEFORE UPDATE ON npcs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'quests_updated_at') THEN
            CREATE TRIGGER quests_updated_at BEFORE UPDATE ON quests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'locations_updated_at') THEN
            CREATE TRIGGER locations_updated_at BEFORE UPDATE ON locations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hooks_updated_at') THEN
            CREATE TRIGGER hooks_updated_at BEFORE UPDATE ON hooks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
          END IF;
        END $$;

        INSERT INTO hooks (campaign_id, client_owner_id, session_id, title, description, status, related_entity_type, related_entity_name, metadata, created_at)
        SELECT memory_events.campaign_id,
               memory_events.client_owner_id,
               memory_events.session_id,
               memory_events.title,
               memory_events.description,
               'open',
               'memory_event',
               memory_events.title,
               memory_events.metadata || jsonb_build_object('source', 'memory_event_backfill', 'memoryEventId', memory_events.id),
               memory_events.created_at
        FROM memory_events
        WHERE memory_events.event_type = 'unresolved_hook'
          AND NOT EXISTS (
            SELECT 1 FROM hooks
            WHERE hooks.campaign_id = memory_events.campaign_id
              AND hooks.client_owner_id = memory_events.client_owner_id
              AND hooks.metadata->>'memoryEventId' = memory_events.id::text
          );
        """;

    await using var cmd = db.CreateCommand(sql);
    await cmd.ExecuteNonQueryAsync();
}

static async Task EnsureDemoSeedData(NpgsqlDataSource db, Guid demoCampaignId, string demoClientOwnerId)
{
    const string sql = """
        INSERT INTO campaigns (id, name, description, system_tone)
        VALUES (
          @campaignId,
          'Shadows of Eldermire',
          'A demo campaign about a misty frontier town, a betrayed party, and old magic waking under Blackwater Mine.',
          'Cinematic, practical, and friendly to a busy Dungeon Master.'
        )
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO sessions (id, campaign_id, client_owner_id, visibility, session_number, title, raw_notes, summary, status)
        VALUES (
          '22222222-2222-2222-2222-222222222222',
          @campaignId,
          @clientOwnerId,
          'private',
          1,
          'The Blackwater Betrayal',
          'Captain Vey betrayed the party at Blackwater Mine. He sold the old royal map to the Ashen Knives and escaped through the smuggler tunnel beneath the collapsed ore lift. Mira Thorn swore to track Vey down. Orren Vale recovered the Dawn Shard from the flooded chapel, but the relic pulsed when it came near the mine''s sealed bronze door.',
          'Captain Vey betrayed the party at Blackwater Mine, sold the royal map to the Ashen Knives, and escaped through an old smuggler tunnel. The party recovered the Dawn Shard and now needs to learn what the relic unlocks.',
          'active'
        )
        ON CONFLICT (id) DO NOTHING;

        UPDATE campaigns
        SET current_session_id = '22222222-2222-2222-2222-222222222222'
        WHERE id = @campaignId
          AND current_session_id IS NULL;

        INSERT INTO party_characters (campaign_id, name, class_name, race, level, hp_current, hp_max, armor_class, notes)
        SELECT @campaignId, 'Mira Thorn', 'Ranger', 'Human', 4, 31, 34, 15, 'Tracks ash-marked creatures. Swore to find Captain Vey.'
        WHERE NOT EXISTS (SELECT 1 FROM party_characters WHERE campaign_id = @campaignId AND name = 'Mira Thorn');

        INSERT INTO party_characters (campaign_id, name, class_name, race, level, hp_current, hp_max, armor_class, notes)
        SELECT @campaignId, 'Orren Vale', 'Cleric', 'Dwarf', 4, 35, 35, 18, 'Keeper of the Dawn Bell. The Dawn Shard reacts near old ruins.'
        WHERE NOT EXISTS (SELECT 1 FROM party_characters WHERE campaign_id = @campaignId AND name = 'Orren Vale');

        INSERT INTO party_characters (campaign_id, name, class_name, race, level, hp_current, hp_max, armor_class, notes)
        SELECT @campaignId, 'Nyx', 'Rogue', 'Tiefling', 4, 24, 28, 14, 'Knows Eldermire smuggling routes and owes a debt to the Silver Lantern Inn.'
        WHERE NOT EXISTS (SELECT 1 FROM party_characters WHERE campaign_id = @campaignId AND name = 'Nyx');

        INSERT INTO npcs (id, campaign_id, client_owner_id, name, role, description, disposition, last_seen_session_id, metadata)
        VALUES
          (
            '33333333-3333-3333-3333-333333333333',
            @campaignId,
            @clientOwnerId,
            'Captain Vey',
            'traitor and former guide',
            'Betrayed the party at Blackwater Mine, sold the old royal map to the Ashen Knives, and escaped through a smuggler tunnel.',
            'hostile',
            '22222222-2222-2222-2222-222222222222',
            '{"source":"demo_seed"}'::jsonb
          ),
          (
            '33333333-3333-3333-3333-333333333334',
            @campaignId,
            @clientOwnerId,
            'Mayor Elowen',
            'Eldermire patron',
            'Asked the party to protect Eldermire before the next new moon.',
            'friendly',
            '22222222-2222-2222-2222-222222222222',
            '{"source":"demo_seed"}'::jsonb
          )
        ON CONFLICT (campaign_id, client_owner_id, name) DO NOTHING;

        INSERT INTO quests (campaign_id, client_owner_id, title, status, description, last_seen_session_id, metadata)
        VALUES
          (@campaignId, @clientOwnerId, 'Hunt Captain Vey', 'open', 'Find Captain Vey and learn who paid him to sell the royal map.', '22222222-2222-2222-2222-222222222222', '{"source":"demo_seed"}'::jsonb),
          (@campaignId, @clientOwnerId, 'Unlock the Dawn Shard', 'open', 'Discover why the Dawn Shard reacts to the sealed bronze door under Blackwater Mine.', '22222222-2222-2222-2222-222222222222', '{"source":"demo_seed"}'::jsonb)
        ON CONFLICT (campaign_id, client_owner_id, title) DO NOTHING;

        INSERT INTO locations (campaign_id, client_owner_id, name, description, location_type, last_seen_session_id, metadata)
        VALUES
          (@campaignId, @clientOwnerId, 'Blackwater Mine', 'A flooded mine with a sealed bronze door, collapsed ore lift, and old smuggler tunnels.', 'dungeon', '22222222-2222-2222-2222-222222222222', '{"source":"demo_seed"}'::jsonb),
          (@campaignId, @clientOwnerId, 'Silver Lantern Inn', 'A busy Eldermire tavern where a masked agent left a black feather as a warning.', 'tavern', '22222222-2222-2222-2222-222222222222', '{"source":"demo_seed"}'::jsonb)
        ON CONFLICT (campaign_id, client_owner_id, name) DO NOTHING;

        INSERT INTO memory_events (campaign_id, client_owner_id, session_id, event_type, title, description, metadata)
        SELECT @campaignId, @clientOwnerId, '22222222-2222-2222-2222-222222222222', 'important_event', 'Captain Vey betrayed the party', 'Captain Vey sold the old royal map to the Ashen Knives and escaped through Blackwater Mine.', '{"source":"demo_seed"}'::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM memory_events
          WHERE campaign_id = @campaignId AND client_owner_id = @clientOwnerId AND title = 'Captain Vey betrayed the party'
        );

        INSERT INTO memory_events (campaign_id, client_owner_id, session_id, event_type, title, description, metadata)
        SELECT @campaignId, @clientOwnerId, '22222222-2222-2222-2222-222222222222', 'unresolved_hook', 'Who paid Captain Vey?', 'The party knows Vey sold the map, but not who funded the betrayal.', '{"source":"demo_seed"}'::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM memory_events
          WHERE campaign_id = @campaignId AND client_owner_id = @clientOwnerId AND title = 'Who paid Captain Vey?'
        );

        INSERT INTO hooks (campaign_id, client_owner_id, session_id, title, description, status, related_entity_type, related_entity_name, metadata)
        SELECT @campaignId, @clientOwnerId, '22222222-2222-2222-2222-222222222222', seed.title, seed.description, seed.status, seed.related_entity_type, seed.related_entity_name, '{"source":"demo_seed"}'::jsonb
        FROM (
          VALUES
            ('Who paid Captain Vey?', 'The party knows Vey sold the map, but not who funded the betrayal.', 'open', 'quest', 'Hunt Captain Vey'),
            ('What does the bronze door under Blackwater Mine unlock?', 'The Dawn Shard pulsed near the sealed bronze door, but no one knows whether it opens a vault, prison, or old shrine.', 'lead', 'location', 'Blackwater Mine'),
            ('Why did a masked agent leave a black feather at the Silver Lantern Inn?', 'Nyx recognizes the inn as a smuggling stop, and the black feather points toward Ashen Knives watchers inside Eldermire.', 'open', 'location', 'Silver Lantern Inn'),
            ('Can Mayor Elowen protect Eldermire before the next new moon?', 'Mayor Elowen asked for help before the next new moon, but the town may already have Ashen Knives informants.', 'rumor', 'npc', 'Mayor Elowen'),
            ('Track Captain Vey through the smuggler tunnel', 'Mira swore to find Vey, and the collapsed ore lift hides the route he used to escape Blackwater Mine.', 'active', 'npc', 'Captain Vey')
        ) AS seed(title, description, status, related_entity_type, related_entity_name)
        WHERE NOT EXISTS (
          SELECT 1 FROM hooks
          WHERE campaign_id = @campaignId
            AND client_owner_id = @clientOwnerId
            AND title = seed.title
        );
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("campaignId", demoCampaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", demoClientOwnerId);
    await cmd.ExecuteNonQueryAsync();
}

static async Task EnsureDemoClientSeed(NpgsqlDataSource db, Guid campaignId, string clientOwnerId, Guid demoCampaignId, string demoClientOwnerId)
{
    if (campaignId != demoCampaignId || clientOwnerId == demoClientOwnerId)
    {
        return;
    }

    const string sql = """
        WITH demo_session AS (
          SELECT id, campaign_id, session_number, title, raw_notes, summary, status
          FROM sessions
          WHERE campaign_id = @campaignId
            AND client_owner_id = @demoClientOwnerId
          ORDER BY session_number ASC
          LIMIT 1
        ),
        client_session AS (
          INSERT INTO sessions (campaign_id, client_owner_id, visibility, session_number, title, raw_notes, summary, status)
          SELECT campaign_id, @clientOwnerId, 'private', session_number, title, raw_notes, summary, status
          FROM demo_session
          WHERE NOT EXISTS (
            SELECT 1 FROM sessions
            WHERE campaign_id = @campaignId
              AND client_owner_id = @clientOwnerId
          )
          RETURNING id
        ),
        target_session AS (
          SELECT id FROM client_session
          UNION ALL
          SELECT id FROM sessions
          WHERE campaign_id = @campaignId
            AND client_owner_id = @clientOwnerId
          ORDER BY id
          LIMIT 1
        )
        INSERT INTO npcs (campaign_id, client_owner_id, name, role, description, disposition, last_seen_session_id, metadata)
        SELECT campaign_id, @clientOwnerId, name, role, description, disposition, (SELECT id FROM target_session), metadata || jsonb_build_object('clientOwnerId', @clientOwnerId)
        FROM npcs
        WHERE campaign_id = @campaignId
          AND client_owner_id = @demoClientOwnerId
        ON CONFLICT (campaign_id, client_owner_id, name) DO NOTHING;

        WITH target_session AS (
          SELECT id
          FROM sessions
          WHERE campaign_id = @campaignId
            AND client_owner_id = @clientOwnerId
          ORDER BY session_number ASC, created_at ASC
          LIMIT 1
        )
        INSERT INTO quests (campaign_id, client_owner_id, title, status, description, last_seen_session_id, metadata)
        SELECT campaign_id, @clientOwnerId, title, status, description, (SELECT id FROM target_session), metadata || jsonb_build_object('clientOwnerId', @clientOwnerId)
        FROM quests
        WHERE campaign_id = @campaignId
          AND client_owner_id = @demoClientOwnerId
        ON CONFLICT (campaign_id, client_owner_id, title) DO NOTHING;

        WITH target_session AS (
          SELECT id
          FROM sessions
          WHERE campaign_id = @campaignId
            AND client_owner_id = @clientOwnerId
          ORDER BY session_number ASC, created_at ASC
          LIMIT 1
        )
        INSERT INTO locations (campaign_id, client_owner_id, name, description, location_type, last_seen_session_id, metadata)
        SELECT campaign_id, @clientOwnerId, name, description, location_type, (SELECT id FROM target_session), metadata || jsonb_build_object('clientOwnerId', @clientOwnerId)
        FROM locations
        WHERE campaign_id = @campaignId
          AND client_owner_id = @demoClientOwnerId
        ON CONFLICT (campaign_id, client_owner_id, name) DO NOTHING;

        WITH target_session AS (
          SELECT id
          FROM sessions
          WHERE campaign_id = @campaignId
            AND client_owner_id = @clientOwnerId
          ORDER BY session_number ASC, created_at ASC
          LIMIT 1
        )
        INSERT INTO memory_events (campaign_id, client_owner_id, session_id, event_type, title, description, metadata)
        SELECT campaign_id, @clientOwnerId, (SELECT id FROM target_session), event_type, title, description, metadata || jsonb_build_object('clientOwnerId', @clientOwnerId)
        FROM memory_events seed
        WHERE campaign_id = @campaignId
          AND client_owner_id = @demoClientOwnerId
          AND NOT EXISTS (
            SELECT 1 FROM memory_events existing
            WHERE existing.campaign_id = seed.campaign_id
              AND existing.client_owner_id = @clientOwnerId
              AND existing.title = seed.title
          );

        WITH target_session AS (
          SELECT id
          FROM sessions
          WHERE campaign_id = @campaignId
            AND client_owner_id = @clientOwnerId
          ORDER BY session_number ASC, created_at ASC
          LIMIT 1
        )
        INSERT INTO hooks (campaign_id, client_owner_id, session_id, title, description, status, related_entity_type, related_entity_name, metadata)
        SELECT @campaignId, @clientOwnerId, (SELECT id FROM target_session), seed.title, seed.description, seed.status, seed.related_entity_type, seed.related_entity_name, '{"source":"demo_seed"}'::jsonb || jsonb_build_object('clientOwnerId', @clientOwnerId)
        FROM (
          VALUES
            ('Who paid Captain Vey?', 'The party knows Vey sold the map, but not who funded the betrayal.', 'open', 'quest', 'Hunt Captain Vey'),
            ('What does the bronze door under Blackwater Mine unlock?', 'The Dawn Shard pulsed near the sealed bronze door, but no one knows whether it opens a vault, prison, or old shrine.', 'lead', 'location', 'Blackwater Mine'),
            ('Why did a masked agent leave a black feather at the Silver Lantern Inn?', 'Nyx recognizes the inn as a smuggling stop, and the black feather points toward Ashen Knives watchers inside Eldermire.', 'open', 'location', 'Silver Lantern Inn'),
            ('Can Mayor Elowen protect Eldermire before the next new moon?', 'Mayor Elowen asked for help before the next new moon, but the town may already have Ashen Knives informants.', 'rumor', 'npc', 'Mayor Elowen'),
            ('Track Captain Vey through the smuggler tunnel', 'Mira swore to find Vey, and the collapsed ore lift hides the route he used to escape Blackwater Mine.', 'active', 'npc', 'Captain Vey')
        ) AS seed(title, description, status, related_entity_type, related_entity_name)
        WHERE NOT EXISTS (
          SELECT 1 FROM hooks existing
          WHERE existing.campaign_id = @campaignId
            AND existing.client_owner_id = @clientOwnerId
            AND existing.title = seed.title
        );

        WITH target_session AS (
          SELECT id
          FROM sessions
          WHERE campaign_id = @campaignId
            AND client_owner_id = @clientOwnerId
          ORDER BY session_number ASC, created_at ASC
          LIMIT 1
        )
        INSERT INTO hooks (campaign_id, client_owner_id, session_id, title, description, status, resolution, related_entity_type, related_entity_name, metadata)
        SELECT campaign_id, @clientOwnerId, (SELECT id FROM target_session), title, description, status, resolution, related_entity_type, related_entity_name, metadata || jsonb_build_object('clientOwnerId', @clientOwnerId)
        FROM hooks seed
        WHERE campaign_id = @campaignId
          AND client_owner_id = @demoClientOwnerId
          AND NOT EXISTS (
            SELECT 1 FROM hooks existing
            WHERE existing.campaign_id = seed.campaign_id
              AND existing.client_owner_id = @clientOwnerId
              AND existing.title = seed.title
          );
        """;

    await using var connection = await db.OpenConnectionAsync();
    await using var transaction = await connection.BeginTransactionAsync();

    await using (var lockCmd = new NpgsqlCommand("SELECT pg_advisory_xact_lock(hashtext(@lockKey));", connection, transaction))
    {
        lockCmd.Parameters.AddWithValue("lockKey", $"demo-seed:{campaignId}:{clientOwnerId}");
        await lockCmd.ExecuteNonQueryAsync();
    }

    await using var cmd = new NpgsqlCommand(sql, connection, transaction);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    cmd.Parameters.AddWithValue("demoClientOwnerId", demoClientOwnerId);
    await cmd.ExecuteNonQueryAsync();
    await transaction.CommitAsync();
}

static CampaignDto ReadCampaign(NpgsqlDataReader reader) => new(
    reader.GetGuid(0),
    reader.GetString(1),
    reader.IsDBNull(2) ? null : reader.GetString(2),
    reader.GetString(3),
    reader.IsDBNull(4) ? null : reader.GetGuid(4),
    reader.IsDBNull(5) ? null : reader.GetDateTime(5),
    reader.GetDateTime(6),
    reader.GetDateTime(7));

static PartyCharacterDto ReadPartyCharacter(NpgsqlDataReader reader) => new(
    reader.GetGuid(0),
    reader.GetGuid(1),
    reader.GetString(2),
    reader.IsDBNull(3) ? null : reader.GetString(3),
    reader.IsDBNull(4) ? null : reader.GetString(4),
    reader.GetInt32(5),
    reader.IsDBNull(6) ? null : reader.GetInt32(6),
    reader.IsDBNull(7) ? null : reader.GetInt32(7),
    reader.IsDBNull(8) ? null : reader.GetInt32(8),
    reader.IsDBNull(9) ? null : reader.GetInt32(9),
    reader.IsDBNull(10) ? null : reader.GetInt32(10),
    reader.IsDBNull(11) ? null : reader.GetInt32(11),
    reader.IsDBNull(12) ? [] : reader.GetFieldValue<string[]>(12),
    reader.IsDBNull(13) ? null : reader.GetString(13),
    reader.GetDateTime(14),
    reader.GetDateTime(15));

static PartyCharacterEventDto ReadPartyCharacterEvent(NpgsqlDataReader reader) => new(
    reader.GetGuid(0),
    reader.GetGuid(1),
    reader.GetGuid(2),
    reader.GetString(3),
    reader.IsDBNull(4) ? null : reader.GetString(4),
    reader.IsDBNull(5) ? null : reader.GetString(5),
    reader.IsDBNull(6) ? null : JsonDocument.Parse(reader.GetString(6)).RootElement.Clone(),
    reader.IsDBNull(7) ? null : JsonDocument.Parse(reader.GetString(7)).RootElement.Clone(),
    reader.IsDBNull(8) ? null : reader.GetGuid(8),
    reader.GetDateTime(9));

static SessionDto ReadSession(NpgsqlDataReader reader) => new(
    reader.GetGuid(0),
    reader.GetGuid(1),
    reader.GetInt32(2),
    reader.GetString(3),
    reader.IsDBNull(4) ? null : reader.GetString(4),
    reader.IsDBNull(5) ? null : reader.GetString(5),
    reader.GetString(6),
    reader.GetDateTime(7),
    reader.GetDateTime(8));

static DocumentDto ReadDocument(NpgsqlDataReader reader, bool includeContent) => new(
    reader.GetGuid(0),
    reader.IsDBNull(1) ? null : reader.GetGuid(1),
    reader.GetString(2),
    reader.GetString(3),
    reader.IsDBNull(4) ? null : reader.GetString(4),
    includeContent ? reader.GetString(5) : null,
    JsonDocument.Parse(reader.GetString(6)).RootElement.Clone(),
    reader.GetDateTime(7),
    reader.GetInt32(8));

static async Task<CampaignDto?> LoadCampaign(Guid campaignId, NpgsqlDataSource db)
{
    const string sql = """
        SELECT id, name, description, system_tone, current_session_id, archived_at, created_at, updated_at
        FROM campaigns
        WHERE id = @id
          AND archived_at IS NULL
        """;
    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("id", campaignId);
    await using var reader = await cmd.ExecuteReaderAsync();
    return await reader.ReadAsync() ? ReadCampaign(reader) : null;
}

static async Task<List<PartyCharacterDto>> LoadParty(Guid campaignId, NpgsqlDataSource db)
{
    const string sql = """
        SELECT id, campaign_id, name, class_name, race, level, hp_current, hp_max, temp_hp,
               armor_class, initiative_modifier, passive_perception, conditions, notes, created_at, updated_at
        FROM party_characters
        WHERE campaign_id = @campaignId
          AND archived_at IS NULL
        ORDER BY created_at ASC
        """;
    var party = new List<PartyCharacterDto>();
    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        party.Add(ReadPartyCharacter(reader));
    }

    return party;
}

static async Task<CampaignMemoryDto> LoadCampaignMemory(Guid campaignId, string clientOwnerId, NpgsqlDataSource db)
{
    var npcs = await LoadMemoryRows<NpcDto>(db, """
        SELECT id, campaign_id, name, role, description, disposition, last_seen_session_id, metadata, created_at, updated_at
        FROM npcs WHERE campaign_id = @campaignId AND client_owner_id = @clientOwnerId ORDER BY updated_at DESC, name
        """, campaignId, clientOwnerId, ReadNpc);
    var quests = await LoadMemoryRows<QuestDto>(db, """
        SELECT id, campaign_id, title, status, description, last_seen_session_id, metadata, created_at, updated_at
        FROM quests WHERE campaign_id = @campaignId AND client_owner_id = @clientOwnerId ORDER BY updated_at DESC, title
        """, campaignId, clientOwnerId, ReadQuest);
    var locations = await LoadMemoryRows<LocationDto>(db, """
        SELECT id, campaign_id, name, description, location_type, last_seen_session_id, metadata, created_at, updated_at
        FROM locations WHERE campaign_id = @campaignId AND client_owner_id = @clientOwnerId ORDER BY updated_at DESC, name
        """, campaignId, clientOwnerId, ReadLocation);
    var encounters = await LoadMemoryRows<EncounterDto>(db, """
        SELECT id, campaign_id, session_id, title, summary, outcome, metadata, created_at
        FROM encounters WHERE campaign_id = @campaignId AND client_owner_id = @clientOwnerId ORDER BY created_at DESC, title
        """, campaignId, clientOwnerId, ReadEncounter);
    var events = await LoadMemoryRows<MemoryEventDto>(db, """
        SELECT id, campaign_id, session_id, event_type, title, description, metadata, created_at
        FROM memory_events WHERE campaign_id = @campaignId AND client_owner_id = @clientOwnerId ORDER BY created_at DESC LIMIT 50
        """, campaignId, clientOwnerId, ReadMemoryEvent);
    var hooks = await LoadMemoryRows<HookDto>(db, """
        SELECT id, campaign_id, session_id, title, description, status, resolution, related_entity_type, related_entity_name, metadata, created_at, updated_at
        FROM hooks WHERE campaign_id = @campaignId AND client_owner_id = @clientOwnerId ORDER BY updated_at DESC, created_at DESC, title
        """, campaignId, clientOwnerId, ReadHook);

    return new CampaignMemoryDto(npcs, quests, locations, encounters, events, hooks);
}

static async Task<PartyCharacterDto?> LoadPartyCharacter(Guid characterId, NpgsqlDataSource db)
{
    const string sql = """
        SELECT id, campaign_id, name, class_name, race, level, hp_current, hp_max, temp_hp,
               armor_class, initiative_modifier, passive_perception, conditions, notes, created_at, updated_at
        FROM party_characters
        WHERE id = @characterId
          AND archived_at IS NULL
          AND EXISTS (
            SELECT 1 FROM campaigns c
            WHERE c.id = party_characters.campaign_id
              AND c.archived_at IS NULL
          )
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("characterId", characterId);
    await using var reader = await cmd.ExecuteReaderAsync();
    return await reader.ReadAsync() ? ReadPartyCharacter(reader) : null;
}

static async Task<List<PartyCharacterEventDto>> LoadPartyEvents(string sql, NpgsqlDataSource db, Action<NpgsqlCommand> bind)
{
    var events = new List<PartyCharacterEventDto>();
    await using var cmd = db.CreateCommand(sql);
    bind(cmd);
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        events.Add(ReadPartyCharacterEvent(reader));
    }

    return events;
}

static void AddPartyCharacterParameters(NpgsqlCommand cmd, PartyCharacterWriteRequest request)
{
    cmd.Parameters.AddWithValue("className", BlankToDbNull(request.ClassName));
    cmd.Parameters.AddWithValue("race", BlankToDbNull(request.Race));
    cmd.Parameters.AddWithValue("level", request.Level < 1 ? 1 : request.Level);
    cmd.Parameters.AddWithValue("hpCurrent", (object?)request.HpCurrent ?? DBNull.Value);
    cmd.Parameters.AddWithValue("hpMax", (object?)request.HpMax ?? DBNull.Value);
    cmd.Parameters.AddWithValue("tempHp", (object?)request.TempHp ?? DBNull.Value);
    cmd.Parameters.AddWithValue("armorClass", (object?)request.ArmorClass ?? DBNull.Value);
    cmd.Parameters.AddWithValue("initiativeModifier", (object?)request.InitiativeModifier ?? DBNull.Value);
    cmd.Parameters.AddWithValue("passivePerception", (object?)request.PassivePerception ?? DBNull.Value);
    cmd.Parameters.Add(new NpgsqlParameter("conditions", NpgsqlDbType.Array | NpgsqlDbType.Text)
    {
        Value = request.Conditions is { Length: > 0 }
            ? request.Conditions.Where(condition => !string.IsNullOrWhiteSpace(condition)).Select(condition => condition.Trim()).ToArray()
            : DBNull.Value
    });
    cmd.Parameters.AddWithValue("notes", BlankToDbNull(request.Notes));
}

static object BlankToDbNull(string? value) =>
    string.IsNullOrWhiteSpace(value) ? DBNull.Value : value.Trim();

static string? NormalizePromptSuggestionMode(string? mode)
{
    var normalized = string.IsNullOrWhiteSpace(mode) ? "auto" : mode.Trim().ToLowerInvariant();
    return normalized is "auto" or "rules" or "npc" or "character" or "encounter" or "recap" or "summarize" ? normalized : null;
}

static string? NormalizeStructuredImageOutputType(string? type)
{
    var normalized = string.IsNullOrWhiteSpace(type) ? "" : type.Trim().ToLowerInvariant();
    return normalized is "npc" or "character" or "encounter" ? normalized : null;
}

static string? NormalizeImageStylePreset(string? preset)
{
    var normalized = string.IsNullOrWhiteSpace(preset) ? "cinematic" : preset.Trim().ToLowerInvariant().Replace("_", " ");
    return normalized is "cinematic" or "parchment sketch" or "combat stance" or "anime"
        ? normalized
        : null;
}

static bool ImageStylePresetAllowedForOutputType(string outputType, string stylePreset) =>
    outputType switch
    {
        "character" => stylePreset is "cinematic" or "parchment sketch" or "combat stance" or "anime",
        "npc" => stylePreset is "cinematic" or "parchment sketch" or "anime",
        "encounter" => stylePreset is "cinematic" or "anime",
        _ => false
    };

static string ImageStylePresetErrorMessage(string outputType) =>
    outputType switch
    {
        "character" => "stylePreset must be cinematic, parchment sketch, combat stance, or anime for character.",
        "npc" => "stylePreset must be cinematic, parchment sketch, or anime for npc.",
        "encounter" => "stylePreset must be cinematic or anime for encounter.",
        _ => "stylePreset must match the selected structuredOutputType."
    };

static Dictionary<string, object?> BuildStructuredMetadata(string clientOwnerId, IEnumerable<KeyValuePair<string, object?>> values, SaveImageMetadata? image, string? imageOutputType = null)
{
    var metadata = new Dictionary<string, object?>
    {
        ["source"] = "structured_output",
        ["clientOwnerId"] = clientOwnerId
    };

    foreach (var (key, value) in values)
    {
        metadata[key] = value;
    }

    foreach (var (key, value) in BuildValidatedImageMetadata(image, imageOutputType))
    {
        metadata[key] = value;
    }

    return metadata;
}

static Dictionary<string, object?> BuildValidatedImageMetadata(SaveImageMetadata? image, string? imageOutputType = null)
{
    var metadata = new Dictionary<string, object?>();
    if (image is null)
    {
        return metadata;
    }

    var imageUrl = ValidateImageUrl(image.ImageUrl);
    var imagePrompt = CompactText(image.ImagePrompt, 1500);
    var provider = ValidateImageProvider(image.ImageProvider);
    var model = CompactText(image.ImageModel, 120);
    var stylePreset = NormalizeImageStylePreset(image.ImageStylePreset);
    if (stylePreset is not null && imageOutputType is not null && !ImageStylePresetAllowedForOutputType(imageOutputType, stylePreset))
    {
        stylePreset = null;
    }
    var generatedAt = image.ImageGeneratedAt is DateTimeOffset timestamp
        ? timestamp.UtcDateTime.ToString("O")
        : null;

    if (imageUrl is not null) metadata["imageUrl"] = imageUrl;
    if (!string.IsNullOrWhiteSpace(imagePrompt)) metadata["imagePrompt"] = imagePrompt;
    if (provider is not null) metadata["imageProvider"] = provider;
    if (!string.IsNullOrWhiteSpace(model)) metadata["imageModel"] = model;
    if (generatedAt is not null) metadata["imageGeneratedAt"] = generatedAt;
    if (stylePreset is not null) metadata["imageStylePreset"] = stylePreset;
    return metadata;
}

static string? ValidateImageUrl(string? value)
{
    if (string.IsNullOrWhiteSpace(value))
    {
        return null;
    }

    var trimmed = value.Trim();
    if (trimmed.Length > 4096)
    {
        return null;
    }
    if (trimmed.StartsWith("data:image/svg+xml", StringComparison.OrdinalIgnoreCase))
    {
        return trimmed;
    }
    if (Uri.TryCreate(trimmed, UriKind.Absolute, out var uri) && uri.Scheme is "https" or "http")
    {
        return trimmed;
    }
    return null;
}

static string? ValidateImageProvider(string? value)
{
    var normalized = string.IsNullOrWhiteSpace(value) ? "" : value.Trim().ToLowerInvariant();
    return normalized is "mock" or "gemini" or "vertex" ? normalized : null;
}

static bool TryPrepareUploadDocument(UploadDocumentRequest request, out PreparedUploadDocument upload, out string validationError)
{
    upload = new PreparedUploadDocument("", "", "rules", null);
    validationError = "";

    if (string.IsNullOrWhiteSpace(request.Title))
    {
        validationError = "Give this Campaign Knowledge entry a title.";
        return false;
    }

    if (string.IsNullOrWhiteSpace(request.Content))
    {
        validationError = "Add a .txt or .md file, or paste some campaign knowledge first.";
        return false;
    }

    var contentBytes = Encoding.UTF8.GetByteCount(request.Content);
    if (contentBytes > DocumentUploadRules.MaxUploadBytes)
    {
        validationError = "That file is too large. Campaign Knowledge supports files up to 2 MB.";
        return false;
    }

    var sourceType = string.IsNullOrWhiteSpace(request.SourceType) ? "rules" : request.SourceType.Trim().ToLowerInvariant();
    if (!DocumentUploadRules.AllowedSourceTypes.Contains(sourceType))
    {
        validationError = "Choose Rules or Homebrew as the document type.";
        return false;
    }

    var originalFilename = NormalizeUploadFilename(request.OriginalFilename);
    if (!string.IsNullOrWhiteSpace(request.OriginalFilename) && originalFilename is null)
    {
        validationError = "Choose a .txt or .md file with a readable file name.";
        return false;
    }

    if (originalFilename is not null)
    {
        var extension = Path.GetExtension(originalFilename).ToLowerInvariant();
        if (!DocumentUploadRules.AllowedExtensions.Contains(extension))
        {
            validationError = "Choose a .txt or .md file for Campaign Knowledge.";
            return false;
        }
    }

    upload = new PreparedUploadDocument(
        request.Title.Trim(),
        request.Content.Trim(),
        sourceType,
        originalFilename);
    return true;
}

static string? NormalizeUploadFilename(string? filename)
{
    if (string.IsNullOrWhiteSpace(filename))
    {
        return null;
    }

    var safeName = Path.GetFileName(filename.Trim());
    safeName = Regex.Replace(safeName, @"[\p{C}]", "");
    safeName = Regex.Replace(safeName, @"[^A-Za-z0-9._ -]+", "-");
    safeName = Regex.Replace(safeName, @"\s+", " ").Trim();
    if (string.IsNullOrWhiteSpace(safeName))
    {
        return null;
    }

    if (safeName.Length <= DocumentUploadRules.MaxFilenameLength)
    {
        return safeName;
    }

    var extension = Path.GetExtension(safeName);
    var basename = Path.GetFileNameWithoutExtension(safeName);
    var maxBasenameLength = Math.Max(1, DocumentUploadRules.MaxFilenameLength - extension.Length);
    return basename[..Math.Min(basename.Length, maxBasenameLength)] + extension;
}

static string? ValidatePartyCharacterInput(int level, int? hpCurrent, int? hpMax, int? tempHp)
{
    if (level < 1)
    {
        return "Level must be at least 1.";
    }
    if (hpCurrent is < 0 || hpMax is < 0 || tempHp is < 0)
    {
        return "HP values cannot be negative.";
    }
    if (hpCurrent is not null && hpMax is not null && hpCurrent > hpMax + (tempHp ?? 0))
    {
        return "Current HP cannot be greater than max HP unless temp HP covers the excess.";
    }
    return null;
}

static string BuildPartyUpdateTitle(PartyCharacterDto before, PartyCharacterDto after)
{
    if (before.Level != after.Level)
    {
        return $"Level changed to {after.Level}";
    }
    if (before.HpCurrent != after.HpCurrent || before.TempHp != after.TempHp)
    {
        return "HP updated";
    }
    return "Character updated";
}

static async Task<PartyCharacterEventDto> InsertPartyEvent(
    NpgsqlDataSource db,
    Guid campaignId,
    Guid characterId,
    string eventType,
    string? title,
    string? description,
    PartyCharacterDto? beforeState,
    PartyCharacterDto? afterState,
    Guid? sessionId)
{
    const string sql = """
        INSERT INTO party_character_events
          (campaign_id, character_id, event_type, title, description, before_state, after_state, session_id)
        VALUES
          (@campaignId, @characterId, @eventType, @title, @description, @beforeState, @afterState, @sessionId)
        RETURNING id, campaign_id, character_id, event_type, title, description, before_state, after_state, session_id, created_at
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("characterId", characterId);
    cmd.Parameters.AddWithValue("eventType", eventType);
    cmd.Parameters.AddWithValue("title", BlankToDbNull(title));
    cmd.Parameters.AddWithValue("description", BlankToDbNull(description));
    cmd.Parameters.Add(new NpgsqlParameter("beforeState", NpgsqlDbType.Jsonb)
    {
        Value = beforeState is null ? DBNull.Value : JsonSerializer.Serialize(beforeState)
    });
    cmd.Parameters.Add(new NpgsqlParameter("afterState", NpgsqlDbType.Jsonb)
    {
        Value = afterState is null ? DBNull.Value : JsonSerializer.Serialize(afterState)
    });
    cmd.Parameters.AddWithValue("sessionId", (object?)sessionId ?? DBNull.Value);

    await using var reader = await cmd.ExecuteReaderAsync();
    await reader.ReadAsync();
    return ReadPartyCharacterEvent(reader);
}

static async Task<DocumentDto?> LoadDocument(Guid documentId, NpgsqlDataSource db)
{
    const string sql = """
        SELECT kd.id, kd.campaign_id, kd.source_type, kd.title, kd.original_filename, kd.content, kd.metadata, kd.created_at,
          count(kc.id)::int AS chunk_count
        FROM knowledge_documents kd
        LEFT JOIN knowledge_chunks kc ON kc.document_id = kd.id
        WHERE kd.id = @documentId
        GROUP BY kd.id
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("documentId", documentId);
    await using var reader = await cmd.ExecuteReaderAsync();
    return await reader.ReadAsync() ? ReadDocument(reader, includeContent: true) : null;
}

static async Task<SessionDto?> LoadSession(Guid sessionId, string clientOwnerId, NpgsqlDataSource db)
{
    const string sql = """
        SELECT id, campaign_id, session_number, title, raw_notes, summary, status, created_at, updated_at
        FROM sessions
        WHERE id = @sessionId
          AND client_owner_id = @clientOwnerId
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("sessionId", sessionId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    await using var reader = await cmd.ExecuteReaderAsync();
    return await reader.ReadAsync() ? ReadSession(reader) : null;
}

static async Task<bool> SessionBelongsToCampaignClient(Guid sessionId, Guid campaignId, string clientOwnerId, NpgsqlDataSource db)
{
    const string sql = """
        SELECT EXISTS (
          SELECT 1 FROM sessions
          WHERE id = @sessionId
            AND campaign_id = @campaignId
            AND client_owner_id = @clientOwnerId
        )
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("sessionId", sessionId);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    var result = await cmd.ExecuteScalarAsync();
    return result is bool value && value;
}

static string? NormalizeHookStatus(string? status)
{
    var normalized = string.IsNullOrWhiteSpace(status) ? "open" : status.Trim().ToLowerInvariant();
    return normalized is "open" or "rumor" or "lead" or "active" or "resolved" or "dropped" ? normalized : null;
}

static string HookStatusError()
{
    return "status must be open, rumor, lead, active, resolved, or dropped.";
}

static async Task SaveSessionMemory(SessionDto session, SessionSummaryResponse summary, string clientOwnerId, NpgsqlDataSource db)
{
    await using var connection = await db.OpenConnectionAsync();
    await using var transaction = await connection.BeginTransactionAsync();

    await using (var cmd = new NpgsqlCommand("UPDATE sessions SET summary = @summary, status = 'summarized' WHERE id = @sessionId AND client_owner_id = @clientOwnerId", connection, transaction))
    {
        cmd.Parameters.AddWithValue("summary", summary.Summary);
        cmd.Parameters.AddWithValue("sessionId", session.Id);
        cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
        await cmd.ExecuteNonQueryAsync();
    }

    await using (var cleanup = new NpgsqlCommand("""
        DELETE FROM encounters
        WHERE session_id = @sessionId
          AND COALESCE(metadata->>'source', 'session_summary') <> 'structured_output';
        DELETE FROM hooks
        WHERE session_id = @sessionId
          AND COALESCE(metadata->>'source', 'session_summary') = 'session_summary';
        DELETE FROM memory_events WHERE session_id = @sessionId;
        DELETE FROM npcs WHERE last_seen_session_id = @sessionId;
        DELETE FROM quests WHERE last_seen_session_id = @sessionId;
        DELETE FROM locations WHERE last_seen_session_id = @sessionId;
        """, connection, transaction))
    {
        cleanup.Parameters.AddWithValue("sessionId", session.Id);
        await cleanup.ExecuteNonQueryAsync();
    }

    foreach (var npc in summary.Npcs)
    {
        await using var cmd = new NpgsqlCommand("""
            INSERT INTO npcs (campaign_id, client_owner_id, name, role, description, disposition, last_seen_session_id, metadata)
            VALUES (@campaignId, @clientOwnerId, @name, @role, @description, @disposition, @sessionId, @metadata)
            ON CONFLICT (campaign_id, client_owner_id, name) DO UPDATE
            SET role = COALESCE(EXCLUDED.role, npcs.role),
                description = COALESCE(EXCLUDED.description, npcs.description),
                disposition = COALESCE(EXCLUDED.disposition, npcs.disposition),
                last_seen_session_id = EXCLUDED.last_seen_session_id,
                metadata = npcs.metadata || EXCLUDED.metadata
            """, connection, transaction);
        cmd.Parameters.AddWithValue("campaignId", session.CampaignId);
        cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
        cmd.Parameters.AddWithValue("name", npc.Name);
        cmd.Parameters.AddWithValue("role", (object?)npc.Role ?? DBNull.Value);
        cmd.Parameters.AddWithValue("description", (object?)npc.Description ?? DBNull.Value);
        cmd.Parameters.AddWithValue("disposition", (object?)npc.Disposition ?? DBNull.Value);
        cmd.Parameters.AddWithValue("sessionId", session.Id);
        cmd.Parameters.Add(new NpgsqlParameter("metadata", NpgsqlDbType.Jsonb) { Value = "{}" });
        await cmd.ExecuteNonQueryAsync();
    }

    foreach (var quest in summary.Quests)
    {
        await using var cmd = new NpgsqlCommand("""
            INSERT INTO quests (campaign_id, client_owner_id, title, status, description, last_seen_session_id, metadata)
            VALUES (@campaignId, @clientOwnerId, @title, @status, @description, @sessionId, @metadata)
            ON CONFLICT (campaign_id, client_owner_id, title) DO UPDATE
            SET status = EXCLUDED.status,
                description = COALESCE(EXCLUDED.description, quests.description),
                last_seen_session_id = EXCLUDED.last_seen_session_id,
                metadata = quests.metadata || EXCLUDED.metadata
            """, connection, transaction);
        cmd.Parameters.AddWithValue("campaignId", session.CampaignId);
        cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
        cmd.Parameters.AddWithValue("title", quest.Title);
        cmd.Parameters.AddWithValue("status", string.IsNullOrWhiteSpace(quest.Status) ? "open" : quest.Status);
        cmd.Parameters.AddWithValue("description", (object?)quest.Description ?? DBNull.Value);
        cmd.Parameters.AddWithValue("sessionId", session.Id);
        cmd.Parameters.Add(new NpgsqlParameter("metadata", NpgsqlDbType.Jsonb) { Value = "{}" });
        await cmd.ExecuteNonQueryAsync();
    }

    foreach (var location in summary.Locations)
    {
        await using var cmd = new NpgsqlCommand("""
            INSERT INTO locations (campaign_id, client_owner_id, name, description, location_type, last_seen_session_id, metadata)
            VALUES (@campaignId, @clientOwnerId, @name, @description, @locationType, @sessionId, @metadata)
            ON CONFLICT (campaign_id, client_owner_id, name) DO UPDATE
            SET description = COALESCE(EXCLUDED.description, locations.description),
                location_type = COALESCE(EXCLUDED.location_type, locations.location_type),
                last_seen_session_id = EXCLUDED.last_seen_session_id,
                metadata = locations.metadata || EXCLUDED.metadata
            """, connection, transaction);
        cmd.Parameters.AddWithValue("campaignId", session.CampaignId);
        cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
        cmd.Parameters.AddWithValue("name", location.Name);
        cmd.Parameters.AddWithValue("description", (object?)location.Description ?? DBNull.Value);
        cmd.Parameters.AddWithValue("locationType", (object?)location.LocationType ?? DBNull.Value);
        cmd.Parameters.AddWithValue("sessionId", session.Id);
        cmd.Parameters.Add(new NpgsqlParameter("metadata", NpgsqlDbType.Jsonb) { Value = "{}" });
        await cmd.ExecuteNonQueryAsync();
    }

    foreach (var encounter in summary.Encounters)
    {
        await using var cmd = new NpgsqlCommand("""
            INSERT INTO encounters (campaign_id, client_owner_id, session_id, title, summary, outcome, metadata)
            VALUES (@campaignId, @clientOwnerId, @sessionId, @title, @summary, @outcome, @metadata)
            ON CONFLICT (campaign_id, client_owner_id, title) DO UPDATE
            SET session_id = EXCLUDED.session_id,
                summary = COALESCE(EXCLUDED.summary, encounters.summary),
                outcome = COALESCE(EXCLUDED.outcome, encounters.outcome),
                metadata = encounters.metadata || EXCLUDED.metadata
            WHERE COALESCE(encounters.metadata->>'source', 'session_summary') <> 'structured_output'
            """, connection, transaction);
        cmd.Parameters.AddWithValue("campaignId", session.CampaignId);
        cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
        cmd.Parameters.AddWithValue("sessionId", session.Id);
        cmd.Parameters.AddWithValue("title", encounter.Title);
        cmd.Parameters.AddWithValue("summary", (object?)encounter.Summary ?? DBNull.Value);
        cmd.Parameters.AddWithValue("outcome", (object?)encounter.Outcome ?? DBNull.Value);
        cmd.Parameters.Add(new NpgsqlParameter("metadata", NpgsqlDbType.Jsonb) { Value = "{}" });
        await cmd.ExecuteNonQueryAsync();
    }

    foreach (var evt in summary.ImportantEvents)
    {
        await InsertMemoryEvent(connection, transaction, session, clientOwnerId, "important_event", evt, evt);
    }
    foreach (var hook in summary.UnresolvedHooks)
    {
        await InsertMemoryEvent(connection, transaction, session, clientOwnerId, "unresolved_hook", hook, hook);
        await InsertHook(connection, transaction, session, clientOwnerId, hook, hook, "open", null, "session_summary", session.Title, "session_summary");
    }

    await transaction.CommitAsync();
}

static async Task InsertMemoryEvent(NpgsqlConnection connection, NpgsqlTransaction transaction, SessionDto session, string clientOwnerId, string type, string title, string description)
{
    await using var cmd = new NpgsqlCommand("""
        INSERT INTO memory_events (campaign_id, client_owner_id, session_id, event_type, title, description, metadata)
        VALUES (@campaignId, @clientOwnerId, @sessionId, @eventType, @title, @description, @metadata)
        """, connection, transaction);
    cmd.Parameters.AddWithValue("campaignId", session.CampaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    cmd.Parameters.AddWithValue("sessionId", session.Id);
    cmd.Parameters.AddWithValue("eventType", type);
    cmd.Parameters.AddWithValue("title", title.Length > 120 ? title[..120] : title);
    cmd.Parameters.AddWithValue("description", description);
    cmd.Parameters.Add(new NpgsqlParameter("metadata", NpgsqlDbType.Jsonb) { Value = "{}" });
    await cmd.ExecuteNonQueryAsync();
}

static async Task InsertHook(
    NpgsqlConnection connection,
    NpgsqlTransaction transaction,
    SessionDto session,
    string clientOwnerId,
    string title,
    string description,
    string status,
    string? resolution,
    string? relatedEntityType,
    string? relatedEntityName,
    string source)
{
    await using var cmd = new NpgsqlCommand("""
        INSERT INTO hooks (campaign_id, client_owner_id, session_id, title, description, status, resolution, related_entity_type, related_entity_name, metadata)
        VALUES (@campaignId, @clientOwnerId, @sessionId, @title, @description, @status, @resolution, @relatedEntityType, @relatedEntityName, @metadata)
        """, connection, transaction);
    cmd.Parameters.AddWithValue("campaignId", session.CampaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    cmd.Parameters.AddWithValue("sessionId", session.Id);
    cmd.Parameters.AddWithValue("title", title.Length > 160 ? title[..160] : title);
    cmd.Parameters.AddWithValue("description", description);
    cmd.Parameters.AddWithValue("status", status);
    cmd.Parameters.AddWithValue("resolution", (object?)resolution ?? DBNull.Value);
    cmd.Parameters.AddWithValue("relatedEntityType", (object?)relatedEntityType ?? DBNull.Value);
    cmd.Parameters.AddWithValue("relatedEntityName", (object?)relatedEntityName ?? DBNull.Value);
    cmd.Parameters.Add(new NpgsqlParameter("metadata", NpgsqlDbType.Jsonb)
    {
        Value = JsonSerializer.Serialize(new { source, clientOwnerId })
    });
    await cmd.ExecuteNonQueryAsync();
}

static async Task<DocumentDto> CreateMemoryDocument(SessionDto session, SessionSummaryResponse summary, string clientOwnerId, NpgsqlDataSource db)
{
    const string deleteSql = """
        DELETE FROM knowledge_documents
        WHERE campaign_id = @campaignId
          AND source_type = 'campaign_memory'
          AND metadata->>'sessionId' = @sessionId
          AND metadata->>'clientOwnerId' = @clientOwnerId
          AND COALESCE(metadata->>'memoryType', 'session') = 'session'
        """;
    await using (var deleteCmd = db.CreateCommand(deleteSql))
    {
        deleteCmd.Parameters.AddWithValue("campaignId", session.CampaignId);
        deleteCmd.Parameters.AddWithValue("sessionId", session.Id.ToString());
        deleteCmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
        await deleteCmd.ExecuteNonQueryAsync();
    }

    var content = BuildMemoryDocumentContent(session, summary);
    const string insertSql = """
        INSERT INTO knowledge_documents (campaign_id, source_type, title, original_filename, content, metadata)
        VALUES (@campaignId, 'campaign_memory', @title, NULL, @content, @metadata)
        RETURNING id, campaign_id, source_type, title, original_filename, content, metadata, created_at,
          (SELECT count(*)::int FROM knowledge_chunks WHERE document_id = knowledge_documents.id) AS chunk_count
        """;

    await using var cmd = db.CreateCommand(insertSql);
    cmd.Parameters.AddWithValue("campaignId", session.CampaignId);
    cmd.Parameters.AddWithValue("title", $"Session {session.SessionNumber} Memory - {session.Title}");
    cmd.Parameters.AddWithValue("content", content);
    cmd.Parameters.Add(new NpgsqlParameter("metadata", NpgsqlDbType.Jsonb)
    {
        Value = JsonSerializer.Serialize(new
        {
            status = "uploaded",
            memoryType = "session",
            sessionId = session.Id,
            sessionNumber = session.SessionNumber,
            clientOwnerId
        })
    });

    await using var reader = await cmd.ExecuteReaderAsync();
    await reader.ReadAsync();
    return ReadDocument(reader, includeContent: true);
}

static async Task<DocumentDto> CreateEncounterMemoryDocument(EncounterDto encounter, SaveEncounterRequest request, string clientOwnerId, NpgsqlDataSource db)
{
    var content = BuildEncounterMemoryDocumentContent(encounter, request);
    const string sql = """
        WITH existing AS (
          SELECT id
          FROM knowledge_documents
          WHERE campaign_id = @campaignId
            AND source_type = 'campaign_memory'
            AND metadata->>'clientOwnerId' = @clientOwnerId
            AND metadata->>'encounterId' = @encounterId
          LIMIT 1
        ),
        updated AS (
          UPDATE knowledge_documents
          SET title = @title,
              content = @content,
              metadata = metadata || @metadata
          WHERE id IN (SELECT id FROM existing)
          RETURNING id, campaign_id, source_type, title, original_filename, content, metadata, created_at,
            (SELECT count(*)::int FROM knowledge_chunks WHERE document_id = knowledge_documents.id) AS chunk_count
        ),
        inserted AS (
          INSERT INTO knowledge_documents (campaign_id, source_type, title, original_filename, content, metadata)
          SELECT @campaignId, 'campaign_memory', @title, NULL, @content, @metadata
          WHERE NOT EXISTS (SELECT 1 FROM updated)
          RETURNING id, campaign_id, source_type, title, original_filename, content, metadata, created_at,
            (SELECT count(*)::int FROM knowledge_chunks WHERE document_id = knowledge_documents.id) AS chunk_count
        )
        SELECT * FROM updated
        UNION ALL
        SELECT * FROM inserted
        LIMIT 1
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("campaignId", encounter.CampaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    cmd.Parameters.AddWithValue("encounterId", encounter.Id.ToString());
    cmd.Parameters.AddWithValue("title", $"Encounter Memory - {encounter.Title}");
    cmd.Parameters.AddWithValue("content", content);
    cmd.Parameters.Add(new NpgsqlParameter("metadata", NpgsqlDbType.Jsonb)
    {
        Value = JsonSerializer.Serialize(new
        {
            status = "uploaded",
            memoryType = "encounter",
            encounterId = encounter.Id,
            sessionId = encounter.SessionId,
            clientOwnerId
        })
    });

    await using var reader = await cmd.ExecuteReaderAsync();
    await reader.ReadAsync();
    return ReadDocument(reader, includeContent: true);
}

static string BuildMemoryDocumentContent(SessionDto session, SessionSummaryResponse summary)
{
    return $"""
        # Session {session.SessionNumber}: {session.Title}

        ## Summary
        {summary.Summary}

        ## Important Events
        {string.Join("\n", summary.ImportantEvents.Select(item => $"- {item}"))}

        ## NPCs
        {string.Join("\n", summary.Npcs.Select(item => $"- {item.Name}: {item.Description ?? item.Role ?? "Noted NPC"}"))}

        ## Locations
        {string.Join("\n", summary.Locations.Select(item => $"- {item.Name}: {item.Description ?? item.LocationType ?? "Noted location"}"))}

        ## Quests
        {string.Join("\n", summary.Quests.Select(item => $"- {item.Title}: {item.Description ?? item.Status}"))}

        ## Unresolved Hooks
        {string.Join("\n", summary.UnresolvedHooks.Select(item => $"- {item}"))}
        """;
}

static string BuildEncounterMemoryDocumentContent(EncounterDto encounter, SaveEncounterRequest request)
{
    var monsters = CompactJsonArray(request.Monsters);
    var rewards = CompactList(request.Rewards);
    var hooks = CompactList(request.CampaignHooks);
    return string.Join("\n", new[]
    {
        $"# Encounter: {CompactText(encounter.Title, 120)}",
        $"Difficulty: {CompactText(request.Difficulty, 60)}",
        $"Environment: {CompactText(request.Environment, 120)}",
        $"Monsters: {monsters}",
        $"Tactics: {CompactText(encounter.Summary ?? request.Tactics, 700)}",
        $"Rewards: {rewards}",
        $"Campaign hooks: {hooks}"
    }.Where(line => !line.EndsWith(": ", StringComparison.Ordinal)));
}

static string CompactList(IEnumerable<string>? values, int itemLimit = 8, int itemLength = 120)
{
    var items = values?
        .Select(value => CompactText(value, itemLength))
        .Where(value => !string.IsNullOrWhiteSpace(value))
        .Take(itemLimit)
        .ToArray() ?? [];
    return items.Length == 0 ? "" : string.Join("; ", items);
}

static string CompactJsonArray(IEnumerable<JsonElement>? values, int itemLimit = 8)
{
    var items = values?
        .Select(CompactJsonElement)
        .Where(value => !string.IsNullOrWhiteSpace(value))
        .Take(itemLimit)
        .ToArray() ?? [];
    return items.Length == 0 ? "" : string.Join("; ", items);
}

static string CompactJsonElement(JsonElement value)
{
    if (value.ValueKind == JsonValueKind.Object)
    {
        var fields = new[] { "name", "count", "role", "xp", "cr" }
            .Select(field => value.TryGetProperty(field, out var property) ? CompactJsonScalar(property) : "")
            .Where(part => !string.IsNullOrWhiteSpace(part))
            .ToArray();
        if (fields.Length > 0)
        {
            return CompactText(string.Join(" ", fields), 160);
        }
    }

    return CompactText(value.ToString(), 160);
}

static string CompactJsonScalar(JsonElement value) =>
    value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : value.ToString();

static string CompactText(string? value, int maxLength)
{
    if (string.IsNullOrWhiteSpace(value))
    {
        return "";
    }

    var compact = Regex.Replace(value.Trim(), @"\s+", " ");
    return compact.Length <= maxLength ? compact : compact[..maxLength].TrimEnd() + "...";
}

static async Task<List<T>> LoadMemoryRows<T>(NpgsqlDataSource db, string sql, Guid campaignId, string clientOwnerId, Func<NpgsqlDataReader, T> read)
{
    var rows = new List<T>();
    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(read(reader));
    }
    return rows;
}

static bool MetadataClientOwnerMatches(JsonElement metadata, string clientOwnerId)
{
    return metadata.ValueKind == JsonValueKind.Object
        && metadata.TryGetProperty("clientOwnerId", out var owner)
        && owner.ValueKind == JsonValueKind.String
        && owner.GetString() == clientOwnerId;
}

static NpcDto ReadNpc(NpgsqlDataReader reader) => new(
    reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2),
    reader.IsDBNull(3) ? null : reader.GetString(3),
    reader.IsDBNull(4) ? null : reader.GetString(4),
    reader.IsDBNull(5) ? null : reader.GetString(5),
    reader.IsDBNull(6) ? null : reader.GetGuid(6),
    JsonDocument.Parse(reader.GetString(7)).RootElement.Clone(),
    reader.GetDateTime(8), reader.GetDateTime(9));

static QuestDto ReadQuest(NpgsqlDataReader reader) => new(
    reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3),
    reader.IsDBNull(4) ? null : reader.GetString(4),
    reader.IsDBNull(5) ? null : reader.GetGuid(5),
    JsonDocument.Parse(reader.GetString(6)).RootElement.Clone(),
    reader.GetDateTime(7), reader.GetDateTime(8));

static LocationDto ReadLocation(NpgsqlDataReader reader) => new(
    reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2),
    reader.IsDBNull(3) ? null : reader.GetString(3),
    reader.IsDBNull(4) ? null : reader.GetString(4),
    reader.IsDBNull(5) ? null : reader.GetGuid(5),
    JsonDocument.Parse(reader.GetString(6)).RootElement.Clone(),
    reader.GetDateTime(7), reader.GetDateTime(8));

static EncounterDto ReadEncounter(NpgsqlDataReader reader) => new(
    reader.GetGuid(0), reader.GetGuid(1),
    reader.IsDBNull(2) ? null : reader.GetGuid(2),
    reader.GetString(3),
    reader.IsDBNull(4) ? null : reader.GetString(4),
    reader.IsDBNull(5) ? null : reader.GetString(5),
    JsonDocument.Parse(reader.GetString(6)).RootElement.Clone(),
    reader.GetDateTime(7));

static MemoryEventDto ReadMemoryEvent(NpgsqlDataReader reader) => new(
    reader.GetGuid(0), reader.GetGuid(1),
    reader.IsDBNull(2) ? null : reader.GetGuid(2),
    reader.GetString(3), reader.GetString(4),
    reader.IsDBNull(5) ? null : reader.GetString(5),
    JsonDocument.Parse(reader.GetString(6)).RootElement.Clone(),
    reader.GetDateTime(7));

static HookDto ReadHook(NpgsqlDataReader reader) => new(
    reader.GetGuid(0), reader.GetGuid(1),
    reader.IsDBNull(2) ? null : reader.GetGuid(2),
    reader.GetString(3),
    reader.IsDBNull(4) ? null : reader.GetString(4),
    reader.GetString(5),
    reader.IsDBNull(6) ? null : reader.GetString(6),
    reader.IsDBNull(7) ? null : reader.GetString(7),
    reader.IsDBNull(8) ? null : reader.GetString(8),
    JsonDocument.Parse(reader.GetString(9)).RootElement.Clone(),
    reader.GetDateTime(10),
    reader.GetDateTime(11));

static async Task<Guid> CreateConversation(Guid campaignId, string firstMessage, NpgsqlDataSource db)
{
    const string sql = """
        INSERT INTO ai_conversations (campaign_id, title)
        VALUES (@campaignId, @title)
        RETURNING id
        """;
    var title = firstMessage.Length > 48 ? firstMessage[..48] : firstMessage;
    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("title", title);
    var id = await cmd.ExecuteScalarAsync();
    return (Guid)id!;
}

static async Task<bool> ConversationBelongsToCampaign(Guid conversationId, Guid campaignId, NpgsqlDataSource db)
{
    const string sql = """
        SELECT EXISTS (
          SELECT 1 FROM ai_conversations
          WHERE id = @conversationId AND campaign_id = @campaignId
        )
        """;
    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("conversationId", conversationId);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    var result = await cmd.ExecuteScalarAsync();
    return result is bool value && value;
}

static async Task StoreMessage(Guid conversationId, string role, string? mode, string content, object metadata, NpgsqlDataSource db)
{
    const string sql = """
        INSERT INTO ai_messages (conversation_id, role, mode, content, metadata)
        VALUES (@conversationId, @role, @mode, @content, @metadata)
        """;
    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("conversationId", conversationId);
    cmd.Parameters.AddWithValue("role", role);
    cmd.Parameters.AddWithValue("mode", (object?)mode ?? DBNull.Value);
    cmd.Parameters.AddWithValue("content", content);
    cmd.Parameters.Add(new NpgsqlParameter("metadata", NpgsqlDbType.Jsonb)
    {
        Value = JsonSerializer.Serialize(metadata)
    });
    await cmd.ExecuteNonQueryAsync();
}

static async Task StoreToolCalls(Guid conversationId, JsonElement[] toolCalls, NpgsqlDataSource db)
{
    foreach (var toolCall in toolCalls)
    {
        var toolName = toolCall.TryGetProperty("toolName", out var nameElement)
            ? nameElement.GetString() ?? "unknown"
            : "unknown";
        var arguments = toolCall.TryGetProperty("arguments", out var argumentsElement)
            ? argumentsElement.Clone()
            : JsonDocument.Parse("{}").RootElement.Clone();
        JsonElement? result = toolCall.TryGetProperty("result", out var resultElement) && resultElement.ValueKind != JsonValueKind.Null
            ? resultElement.Clone()
            : null;
        var success = toolCall.TryGetProperty("success", out var successElement) && successElement.ValueKind == JsonValueKind.True;
        var error = toolCall.TryGetProperty("error", out var errorElement) && errorElement.ValueKind != JsonValueKind.Null
            ? errorElement.GetString()
            : null;

        await StoreToolCall(conversationId, toolName, arguments, result, success, error, db);
    }
}

static async Task StoreToolCall(Guid conversationId, string toolName, JsonElement arguments, JsonElement? result, bool success, string? error, NpgsqlDataSource db)
{
    const string sql = """
        INSERT INTO ai_tool_calls (conversation_id, tool_name, arguments, result, success, error)
        VALUES (@conversationId, @toolName, @arguments, @result, @success, @error)
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("conversationId", conversationId);
    cmd.Parameters.AddWithValue("toolName", toolName);
    cmd.Parameters.Add(new NpgsqlParameter("arguments", NpgsqlDbType.Jsonb) { Value = arguments.GetRawText() });
    cmd.Parameters.Add(new NpgsqlParameter("result", NpgsqlDbType.Jsonb)
    {
        Value = result.HasValue ? result.Value.GetRawText() : DBNull.Value
    });
    cmd.Parameters.AddWithValue("success", success);
    cmd.Parameters.AddWithValue("error", (object?)error ?? DBNull.Value);
await cmd.ExecuteNonQueryAsync();
}

static string FriendlyWorkerError(string prefix, string workerError)
{
    var detail = ExtractWorkerErrorDetail(workerError);
    var lower = detail.ToLowerInvariant();

    if (lower.Contains("temporarily overloaded") || lower.Contains("high demand") || lower.Contains("service unavailable"))
    {
        return "The AI is busy right now and could not finish. Please try again in a moment.";
    }

    if (lower.Contains("api key")
        || lower.Contains("api_key")
        || lower.Contains("ai service is not connected")
        || lower.Contains("vertex ai is not connected"))
    {
        return detail;
    }

    if (lower.Contains("rate-limit") || lower.Contains("rate limit") || lower.Contains("quota"))
    {
        return "The AI is getting too many requests right now. Please wait a moment, then try again.";
    }

    if (lower.Contains("embedding dimensions") || lower.Contains("database expects") || lower.Contains("pgvector schema"))
    {
        return "Campaign knowledge is not set up correctly. Ask the app admin to check the knowledge setup.";
    }

    if (prefix.Contains("session summary", StringComparison.OrdinalIgnoreCase))
    {
        return "DNDMind could not summarize that session just now. Please try again in a moment.";
    }

    if (prefix.Contains("knowledge setup", StringComparison.OrdinalIgnoreCase)
        || prefix.Contains("memory ingestion", StringComparison.OrdinalIgnoreCase))
    {
        return "DNDMind could not prepare that campaign knowledge just now. Please try again in a moment.";
    }

    if (prefix.Contains("tool", StringComparison.OrdinalIgnoreCase))
    {
        return "DNDMind could not complete that action just now. Please try again in a moment.";
    }

    return "DNDMind could not get an AI response just now. Please try again in a moment.";
}

static string ExtractWorkerErrorDetail(string workerError)
{
    if (string.IsNullOrWhiteSpace(workerError))
    {
        return "DNDMind could not get an AI response just now. Please try again in a moment.";
    }

    try
    {
        using var document = JsonDocument.Parse(workerError);
        var root = document.RootElement;
        if (root.ValueKind == JsonValueKind.Object)
        {
            if (root.TryGetProperty("detail", out var detailElement) && detailElement.ValueKind == JsonValueKind.String)
            {
                return detailElement.GetString() ?? workerError;
            }
            if (root.TryGetProperty("error", out var errorElement) && errorElement.ValueKind == JsonValueKind.String)
            {
                return errorElement.GetString() ?? workerError;
            }
        }
    }
    catch (JsonException)
    {
        // Framework-level worker errors may arrive as plain text.
    }

    return workerError.Trim();
}

public record CampaignDto(
    Guid Id,
    string Name,
    string? Description,
    string SystemTone,
    Guid? CurrentSessionId,
    DateTime? ArchivedAt,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public record PartyCharacterDto(
    Guid Id,
    Guid CampaignId,
    string Name,
    string? ClassName,
    string? Race,
    int Level,
    int? HpCurrent,
    int? HpMax,
    int? TempHp,
    int? ArmorClass,
    int? InitiativeModifier,
    int? PassivePerception,
    string[] Conditions,
    string? Notes,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public record PartyCharacterEventDto(
    Guid Id,
    Guid CampaignId,
    Guid CharacterId,
    string EventType,
    string? Title,
    string? Description,
    JsonElement? BeforeState,
    JsonElement? AfterState,
    Guid? SessionId,
    DateTime CreatedAt);

public record SessionDto(
    Guid Id,
    Guid CampaignId,
    int SessionNumber,
    string Title,
    string? RawNotes,
    string? Summary,
    string Status,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public record CreateCampaignRequest(string Name, string? Description, string? SystemTone);
public record UpdateCampaignRequest(string? Name, string? Description, string? SystemTone);

public interface PartyCharacterWriteRequest
{
    string? ClassName { get; }
    string? Race { get; }
    int Level { get; }
    int? HpCurrent { get; }
    int? HpMax { get; }
    int? TempHp { get; }
    int? ArmorClass { get; }
    int? InitiativeModifier { get; }
    int? PassivePerception { get; }
    string[]? Conditions { get; }
    string? Notes { get; }
}

public record CreatePartyCharacterRequest(
    string Name,
    string? ClassName,
    string? Race,
    int Level,
    int? HpCurrent,
    int? HpMax,
    int? TempHp,
    int? ArmorClass,
    int? InitiativeModifier,
    int? PassivePerception,
    string[]? Conditions,
    string? Notes) : PartyCharacterWriteRequest;

public record UpdatePartyCharacterRequest(
    string Name,
    string? ClassName,
    string? Race,
    int Level,
    int? HpCurrent,
    int? HpMax,
    int? TempHp,
    int? ArmorClass,
    int? InitiativeModifier,
    int? PassivePerception,
    string[]? Conditions,
    string? Notes) : PartyCharacterWriteRequest;

public record UpdatePartyHpRequest(int? HpCurrent, int? TempHp, string? Note);
public record UpdatePartyLevelRequest(int Level, string? Note);
public record CreatePartyEventRequest(string EventType, string? Title, string? Description, Guid? SessionId);

public record UpsertSessionRequest(
    int SessionNumber,
    string? Title,
    string? RawNotes,
    string? Summary,
    string? Status);

public record ChatContext(bool UseRules, bool UseCampaignMemory, bool UsePartyInfo, bool UseHomebrew);

public record DocumentDto(
    Guid Id,
    Guid? CampaignId,
    string SourceType,
    string Title,
    string? OriginalFilename,
    string? Content,
    JsonElement Metadata,
    DateTime CreatedAt,
    int ChunkCount);

public record UploadDocumentRequest(
    string Title,
    string Content,
    string? SourceType,
    string? OriginalFilename,
    JsonElement? Metadata);

public record PreparedUploadDocument(
    string Title,
    string Content,
    string SourceType,
    string? OriginalFilename);

public record CampaignMemoryDto(
    IReadOnlyList<NpcDto> Npcs,
    IReadOnlyList<QuestDto> Quests,
    IReadOnlyList<LocationDto> Locations,
    IReadOnlyList<EncounterDto> Encounters,
    IReadOnlyList<MemoryEventDto> Events,
    IReadOnlyList<HookDto> Hooks);

public record NpcDto(
    Guid Id,
    Guid CampaignId,
    string Name,
    string? Role,
    string? Description,
    string? Disposition,
    Guid? LastSeenSessionId,
    JsonElement Metadata,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public record QuestDto(
    Guid Id,
    Guid CampaignId,
    string Title,
    string Status,
    string? Description,
    Guid? LastSeenSessionId,
    JsonElement Metadata,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public record LocationDto(
    Guid Id,
    Guid CampaignId,
    string Name,
    string? Description,
    string? LocationType,
    Guid? LastSeenSessionId,
    JsonElement Metadata,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public record EncounterDto(
    Guid Id,
    Guid CampaignId,
    Guid? SessionId,
    string Title,
    string? Summary,
    string? Outcome,
    JsonElement Metadata,
    DateTime CreatedAt);

public record MemoryEventDto(
    Guid Id,
    Guid CampaignId,
    Guid? SessionId,
    string EventType,
    string Title,
    string? Description,
    JsonElement Metadata,
    DateTime CreatedAt);

public record HookDto(
    Guid Id,
    Guid CampaignId,
    Guid? SessionId,
    string Title,
    string? Description,
    string Status,
    string? Resolution,
    string? RelatedEntityType,
    string? RelatedEntityName,
    JsonElement Metadata,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public record ChatRequest(
    Guid CampaignId,
    Guid? ConversationId,
    Guid? SessionId,
    string Message,
    string Mode,
    ChatContext Context);

public record PromptSuggestionRequest(
    Guid CampaignId,
    Guid? SessionId,
    string Mode,
    string? CurrentInput);

public record PromptSuggestionResponse(
    string Prompt,
    string Mode,
    string? ResolvedMode,
    string? Reason);

public record ImageGenerationRequest(
    Guid CampaignId,
    Guid? ConversationId,
    string StructuredOutputType,
    JsonElement StructuredOutputData,
    string? StylePreset);

public record ImageGenerationResponse(
    string? ImageUrl,
    string? ImageData,
    string ImagePrompt,
    string Provider,
    string Model,
    string Status,
    string? Error,
    DateTimeOffset? ImageGeneratedAt,
    string? ImageStylePreset);

public record ToolExecuteRequest(
    Guid? CampaignId,
    Guid? ConversationId,
    string ToolName,
    JsonElement Arguments);

public record ToolExecuteResponse(
    string ToolName,
    JsonElement Arguments,
    JsonElement? Result,
    bool Success,
    string? Error);

public record SaveNpcRequest(
    string Name,
    string? Role,
    string? RaceOrSpecies,
    string? Description,
    string? Personality,
    string? Motivation,
    string? Secret,
    string? RelationshipToParty,
    string? QuestHook,
    SaveImageMetadata? Image);

public record SaveQuestRequest(
    string Title,
    string? Description,
    string? Status,
    string[]? RelatedNpcs,
    string[]? Objectives,
    string? Reward,
    string[]? UnresolvedHooks);

public record SaveLocationRequest(
    string Name,
    string? Type,
    string? Description,
    string? DangerLevel,
    string[]? Secrets,
    string[]? NotableNpcs,
    string[]? QuestHooks);

public record SaveMemoryEventRequest(
    string? EventType,
    string Title,
    string? Description,
    Guid? SessionId,
    string? RelatedEntityType,
    string? RelatedEntityName);

public record SaveHookRequest(
    string Title,
    string? Description,
    string? Status,
    string? Resolution,
    Guid? SessionId,
    string? RelatedEntityType,
    string? RelatedEntityName);

public record UpdateHookRequest(
    string? Title,
    string? Description,
    string? Status,
    string? Resolution,
    Guid? SessionId,
    string? RelatedEntityType,
    string? RelatedEntityName);

public record ResolveHookRequest(string? Resolution);

public record SaveEncounterRequest(
    string Title,
    string? Difficulty,
    string? Environment,
    JsonElement[]? Monsters,
    string? Tactics,
    JsonElement? ScalingOptions,
    string[]? Rewards,
    string[]? CampaignHooks,
    Guid? SessionId,
    SaveImageMetadata? Image);

public record SaveImageMetadata(
    string? ImageUrl,
    string? ImagePrompt,
    string? ImageProvider,
    string? ImageModel,
    DateTimeOffset? ImageGeneratedAt,
    string? ImageStylePreset);

public record AiWorkerChatRequest(
    Guid CampaignId,
    Guid ConversationId,
    string Message,
    string Mode,
    string ClientOwnerId,
    ChatContext Context,
    CampaignDto Campaign,
    IReadOnlyList<PartyCharacterDto> Party,
    SessionDto? Session);

public record AiWorkerPromptSuggestionRequest(
    Guid CampaignId,
    Guid? SessionId,
    string Mode,
    string? CurrentInput,
    string ClientOwnerId,
    CampaignDto Campaign,
    IReadOnlyList<PartyCharacterDto> Party,
    SessionDto? Session,
    CampaignMemoryDto Memory);

public record CampaignRecapRequest(
    Guid? SessionId,
    string? ActiveSessionTitle,
    string? ActiveSessionRawNotes,
    string? ActiveSessionSummary);

public record AiWorkerCampaignRecapRequest(
    Guid CampaignId,
    string CampaignName,
    string ClientOwnerId,
    string? ActiveSessionTitle,
    string? ActiveSessionRawNotes,
    string? ActiveSessionSummary);

public record AiWorkerImageGenerationRequest(
    Guid CampaignId,
    Guid? ConversationId,
    string StructuredOutputType,
    JsonElement StructuredOutputData,
    string StylePreset,
    string ClientOwnerId);

public record AiWorkerIngestDocumentRequest(
    Guid DocumentId,
    Guid? CampaignId,
    string SourceType,
    string Title,
    string Content,
    JsonElement Metadata,
    string? ClientOwnerId);

public record AiWorkerToolExecuteRequest(
    Guid? CampaignId,
    Guid? ConversationId,
    string ToolName,
    JsonElement Arguments,
    string ClientOwnerId);

public record AiWorkerSummarizeSessionRequest(
    Guid CampaignId,
    Guid SessionId,
    int SessionNumber,
    string Title,
    string RawNotes);

public record IngestDocumentResponse(
    Guid DocumentId,
    int ChunkCount,
    string EmbeddingModel,
    bool MockEmbeddings);

public record CampaignRecapResponse(
    string Recap,
    JsonElement[] Citations);

public record SessionSummaryResponse(
    string Summary,
    string[] ImportantEvents,
    ExtractedNpcDto[] Npcs,
    ExtractedLocationDto[] Locations,
    ExtractedQuestDto[] Quests,
    ExtractedEncounterDto[] Encounters,
    string[] Items,
    string[] UnresolvedHooks);

public record ExtractedNpcDto(string Name, string? Role, string? Description, string? Disposition);
public record ExtractedLocationDto(string Name, string? LocationType, string? Description);
public record ExtractedQuestDto(string Title, string Status, string? Description);
public record ExtractedEncounterDto(string Title, string? Summary, string? Outcome);

public record ChatResponse(
    Guid ConversationId,
    string Answer,
    string Mode,
    JsonElement[] Citations,
    JsonElement[] ToolCalls,
    JsonElement? StructuredOutput,
    JsonElement[] SuggestedActions);

public static class DocumentUploadRules
{
    public const int MaxUploadBytes = 2 * 1024 * 1024;
    public const int MaxFilenameLength = 180;
    public static readonly string[] AllowedExtensions = [".txt", ".md"];
    public static readonly string[] AllowedSourceTypes = ["rules", "homebrew"];
}

public interface ICurrentClientService
{
    bool TryGetClientId(out string clientId, out string error);
}

public sealed class CurrentClientService(IHttpContextAccessor httpContextAccessor) : ICurrentClientService
{
    private static readonly Regex SafeClientIdPattern = new("^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$", RegexOptions.Compiled);
    private const string HeaderName = "X-Dndmind-Client-Id";

    public bool TryGetClientId(out string clientId, out string error)
    {
        clientId = string.Empty;
        error = string.Empty;

        var request = httpContextAccessor.HttpContext?.Request;
        if (request is null || !request.Headers.TryGetValue(HeaderName, out var values))
        {
            error = $"{HeaderName} header is required.";
            return false;
        }

        var value = values.FirstOrDefault()?.Trim();
        if (string.IsNullOrWhiteSpace(value))
        {
            error = $"{HeaderName} header is required.";
            return false;
        }

        if (!SafeClientIdPattern.IsMatch(value))
        {
            error = $"{HeaderName} must be a safe local profile id.";
            return false;
        }

        clientId = value;
        return true;
    }
}

public sealed class CloudRunIdentityTokenHandler(IConfiguration configuration) : DelegatingHandler
{
    private static readonly HttpClient MetadataClient = new();
    private static readonly SemaphoreSlim TokenLock = new(1, 1);
    private static string? CachedToken;
    private static DateTimeOffset CachedTokenExpiresAt = DateTimeOffset.MinValue;

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (IsEnabled())
        {
            var audience = configuration["AI_WORKER_AUTH_AUDIENCE"] ?? configuration["AI_WORKER_URL"];
            if (string.IsNullOrWhiteSpace(audience))
            {
                throw new InvalidOperationException("AI_WORKER_AUTH_AUDIENCE or AI_WORKER_URL is required when AI_WORKER_AUTH_ENABLED=true.");
            }

            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await GetIdentityToken(audience.Trim(), cancellationToken));
        }

        return await base.SendAsync(request, cancellationToken);
    }

    private bool IsEnabled()
    {
        return string.Equals(configuration["AI_WORKER_AUTH_ENABLED"], "true", StringComparison.OrdinalIgnoreCase);
    }

    private static async Task<string> GetIdentityToken(string audience, CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        if (!string.IsNullOrWhiteSpace(CachedToken) && CachedTokenExpiresAt > now.AddMinutes(5))
        {
            return CachedToken;
        }

        await TokenLock.WaitAsync(cancellationToken);
        try
        {
            now = DateTimeOffset.UtcNow;
            if (!string.IsNullOrWhiteSpace(CachedToken) && CachedTokenExpiresAt > now.AddMinutes(5))
            {
                return CachedToken;
            }

            using var request = new HttpRequestMessage(
                HttpMethod.Get,
                $"http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience={Uri.EscapeDataString(audience)}");
            request.Headers.Add("Metadata-Flavor", "Google");

            using var token = await MetadataClient.SendAsync(request, cancellationToken);
            token.EnsureSuccessStatusCode();
            CachedToken = (await token.Content.ReadAsStringAsync(cancellationToken)).Trim();
            CachedTokenExpiresAt = now.AddMinutes(50);
            return CachedToken;
        }
        finally
        {
            TokenLock.Release();
        }
    }
}

public static class DeploymentConfig
{
    public static string[] ReadCsv(string? value)
    {
        return string.IsNullOrWhiteSpace(value)
            ? []
            : value.Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    }
}
