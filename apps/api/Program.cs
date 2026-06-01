using System.Text.Json;
using System.Text.RegularExpressions;
using System.Net.Http.Json;
using Npgsql;
using NpgsqlTypes;

var builder = WebApplication.CreateBuilder(args);

var connectionString =
    builder.Configuration.GetConnectionString("Postgres")
    ?? builder.Configuration["POSTGRES_CONNECTION_STRING"]
    ?? "Host=localhost;Port=5432;Database=dndmind;Username=dndmind;Password=dndmind";

builder.Services.AddSingleton(_ => NpgsqlDataSource.Create(connectionString));
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentClientService, CurrentClientService>();
builder.Services.AddHttpClient("ai-worker", client =>
{
    var workerUrl = builder.Configuration["AI_WORKER_URL"] ?? "http://localhost:8001";
    client.BaseAddress = new Uri(workerUrl);
});
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy => policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());
});

var app = builder.Build();
app.UseCors();
await EnsureRagSchema(app.Services.GetRequiredService<NpgsqlDataSource>());

app.MapGet("/api/health", () => Results.Ok(new { status = "ok", service = "api" }));

app.MapGet("/api/campaigns", async (NpgsqlDataSource db) =>
{
    const string sql = """
        SELECT id, name, description, system_tone, current_session_id, created_at, updated_at
        FROM campaigns
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

app.MapPost("/api/campaigns", async (CreateCampaignRequest request, NpgsqlDataSource db) =>
{
    if (string.IsNullOrWhiteSpace(request.Name))
    {
        return Results.BadRequest(new { error = "Campaign name is required." });
    }

    const string sql = """
        INSERT INTO campaigns (name, description, system_tone)
        VALUES (@name, @description, @systemTone)
        RETURNING id, name, description, system_tone, current_session_id, created_at, updated_at
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
    const string sql = """
        SELECT id, name, description, system_tone, current_session_id, created_at, updated_at
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
        RETURNING id, name, description, system_tone, current_session_id, created_at, updated_at
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("id", campaignId);
    cmd.Parameters.AddWithValue("name", request.Name?.Trim() ?? string.Empty);
    cmd.Parameters.AddWithValue("description", (object?)request.Description ?? DBNull.Value);
    cmd.Parameters.AddWithValue("systemTone", request.SystemTone?.Trim() ?? string.Empty);

    await using var reader = await cmd.ExecuteReaderAsync();
    return await reader.ReadAsync() ? Results.Ok(ReadCampaign(reader)) : Results.NotFound();
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

    const string sql = "DELETE FROM sessions WHERE id = @sessionId AND client_owner_id = @clientOwnerId";
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
        return Results.Problem("AI worker returned an empty summary.", statusCode: 502);
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
    var events = await LoadMemoryRows<MemoryEventDto>(db, """
        SELECT id, campaign_id, session_id, event_type, title, description, metadata, created_at
        FROM memory_events WHERE campaign_id = @campaignId AND client_owner_id = @clientOwnerId ORDER BY created_at DESC LIMIT 50
        """, campaignId, clientOwnerId, ReadMemoryEvent);

    return Results.Ok(new CampaignMemoryDto(npcs, quests, locations, events));
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
        Value = JsonSerializer.Serialize(new
        {
            source = "structured_output",
            clientOwnerId,
            request.RaceOrSpecies,
            request.Personality,
            request.Motivation,
            request.Secret,
            request.QuestHook
        })
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

app.MapPost("/api/campaigns/{campaignId:guid}/encounters", async (Guid campaignId, SaveEncounterRequest request, NpgsqlDataSource db, ICurrentClientService currentClient) =>
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

    const string sql = """
        INSERT INTO encounters (campaign_id, client_owner_id, title, summary, outcome, metadata)
        VALUES (@campaignId, @clientOwnerId, @title, @summary, NULL, @metadata)
        RETURNING id, campaign_id, session_id, title, summary, outcome, metadata, created_at
        """;

    await using var cmd = db.CreateCommand(sql);
    cmd.Parameters.AddWithValue("campaignId", campaignId);
    cmd.Parameters.AddWithValue("clientOwnerId", clientOwnerId);
    cmd.Parameters.AddWithValue("title", request.Title.Trim());
    cmd.Parameters.AddWithValue("summary", (object?)request.Tactics?.Trim() ?? DBNull.Value);
    cmd.Parameters.Add(new NpgsqlParameter("metadata", NpgsqlDbType.Jsonb)
    {
        Value = JsonSerializer.Serialize(new
        {
            source = "structured_output",
            clientOwnerId,
            request.Difficulty,
            request.Environment,
            request.Monsters,
            request.ScalingOptions,
            request.Rewards,
            request.CampaignHooks
        })
    });

    await using var reader = await cmd.ExecuteReaderAsync();
    await reader.ReadAsync();
    var encounter = ReadEncounter(reader);
    return Results.Ok(new { id = encounter.Id, encounter });
});

app.MapPost("/api/campaigns/{campaignId:guid}/documents/upload", async (Guid campaignId, UploadDocumentRequest request, NpgsqlDataSource db) =>
{
    if (string.IsNullOrWhiteSpace(request.Title) || string.IsNullOrWhiteSpace(request.Content))
    {
        return Results.BadRequest(new { error = "Document title and content are required." });
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
    cmd.Parameters.AddWithValue("sourceType", string.IsNullOrWhiteSpace(request.SourceType) ? "rules" : request.SourceType.Trim());
    cmd.Parameters.AddWithValue("title", request.Title.Trim());
    cmd.Parameters.AddWithValue("originalFilename", (object?)request.OriginalFilename ?? DBNull.Value);
    cmd.Parameters.AddWithValue("content", request.Content);
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
        return Results.Problem(FriendlyWorkerError("AI document ingestion failed", error), statusCode: 502);
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

    if (document.SourceType == "campaign_memory")
    {
        return Results.BadRequest(new { error = "Session memory documents cannot be deleted from the rules library." });
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

app.MapPost("/api/chat", async (ChatRequest request, NpgsqlDataSource db, IHttpClientFactory httpClientFactory, ICurrentClientService currentClient) =>
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

    var party = await LoadParty(request.CampaignId, db);
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
        party);

    var client = httpClientFactory.CreateClient("ai-worker");
    var workerResponse = await client.PostAsJsonAsync("/ai/chat", workerRequest);
    if (!workerResponse.IsSuccessStatusCode)
    {
        var error = await workerResponse.Content.ReadAsStringAsync();
        return Results.Problem(FriendlyWorkerError("AI request failed", error), statusCode: 502);
    }

    var chatResponse = await workerResponse.Content.ReadFromJsonAsync<ChatResponse>();
    if (chatResponse is null)
    {
        return Results.Problem("AI worker returned an empty response.", statusCode: 502);
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
        return Results.Problem("AI worker returned an empty tool response.", statusCode: 502);
    }

    if (request.ConversationId is not null)
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
          created_at timestamptz NOT NULL DEFAULT now()
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
        END $$;

        CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document_id
          ON knowledge_chunks(document_id);

        CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding_cosine
          ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops)
          WITH (lists = 32)
          WHERE embedding IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_npcs_campaign_id ON npcs(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_quests_campaign_id ON quests(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_locations_campaign_id ON locations(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_encounters_campaign_id ON encounters(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_memory_events_campaign_id ON memory_events(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_party_characters_campaign_id ON party_characters(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_party_character_events_campaign_id ON party_character_events(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_party_character_events_character_id ON party_character_events(character_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_campaign_client_owner ON sessions(campaign_id, client_owner_id);
        CREATE INDEX IF NOT EXISTS idx_npcs_campaign_client_owner ON npcs(campaign_id, client_owner_id);
        CREATE INDEX IF NOT EXISTS idx_quests_campaign_client_owner ON quests(campaign_id, client_owner_id);
        CREATE INDEX IF NOT EXISTS idx_locations_campaign_client_owner ON locations(campaign_id, client_owner_id);
        CREATE INDEX IF NOT EXISTS idx_encounters_campaign_client_owner ON encounters(campaign_id, client_owner_id);
        CREATE INDEX IF NOT EXISTS idx_memory_events_campaign_client_owner ON memory_events(campaign_id, client_owner_id);

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
        END $$;
        """;

    await using var cmd = db.CreateCommand(sql);
    await cmd.ExecuteNonQueryAsync();
}

static CampaignDto ReadCampaign(NpgsqlDataReader reader) => new(
    reader.GetGuid(0),
    reader.GetString(1),
    reader.IsDBNull(2) ? null : reader.GetString(2),
    reader.GetString(3),
    reader.IsDBNull(4) ? null : reader.GetGuid(4),
    reader.GetDateTime(5),
    reader.GetDateTime(6));

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
        SELECT id, name, description, system_tone, current_session_id, created_at, updated_at
        FROM campaigns
        WHERE id = @id
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

static async Task<PartyCharacterDto?> LoadPartyCharacter(Guid characterId, NpgsqlDataSource db)
{
    const string sql = """
        SELECT id, campaign_id, name, class_name, race, level, hp_current, hp_max, temp_hp,
               armor_class, initiative_modifier, passive_perception, conditions, notes, created_at, updated_at
        FROM party_characters
        WHERE id = @characterId
          AND archived_at IS NULL
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
        DELETE FROM encounters WHERE session_id = @sessionId;
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

static async Task<DocumentDto> CreateMemoryDocument(SessionDto session, SessionSummaryResponse summary, string clientOwnerId, NpgsqlDataSource db)
{
    const string deleteSql = """
        DELETE FROM knowledge_documents
        WHERE campaign_id = @campaignId
          AND source_type = 'campaign_memory'
          AND metadata->>'sessionId' = @sessionId
          AND metadata->>'clientOwnerId' = @clientOwnerId
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
            sessionId = session.Id,
            sessionNumber = session.SessionNumber,
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
        return "Gemini is temporarily busy and could not finish this request. Please try again in a moment. If it keeps happening, switch to another Gemini model in .env.";
    }

    if (lower.Contains("api key") || lower.Contains("api_key"))
    {
        return "Gemini is not available because the API key is missing or invalid. Check GEMINI_API_KEY in .env, then restart the worker.";
    }

    if (lower.Contains("rate-limit") || lower.Contains("rate limit") || lower.Contains("quota"))
    {
        return "Gemini is rate-limiting this project right now. Wait a bit, then retry the request.";
    }

    if (lower.Contains("embedding dimensions") || lower.Contains("database expects") || lower.Contains("pgvector schema"))
    {
        return "Gemini returned embeddings in a size that does not match the database vector column. Keep GEMINI_EMBEDDING_DIMENSIONS=1536, restart the worker, and ingest again.";
    }

    return $"{prefix}: {detail}";
}

static string ExtractWorkerErrorDetail(string workerError)
{
    if (string.IsNullOrWhiteSpace(workerError))
    {
        return "The AI worker returned an empty error.";
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

public record CampaignMemoryDto(
    IReadOnlyList<NpcDto> Npcs,
    IReadOnlyList<QuestDto> Quests,
    IReadOnlyList<LocationDto> Locations,
    IReadOnlyList<MemoryEventDto> Events);

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

public record ChatRequest(
    Guid CampaignId,
    Guid? ConversationId,
    string Message,
    string Mode,
    ChatContext Context);

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
    string? QuestHook);

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

public record SaveEncounterRequest(
    string Title,
    string? Difficulty,
    string? Environment,
    JsonElement[]? Monsters,
    string? Tactics,
    JsonElement? ScalingOptions,
    string[]? Rewards,
    string[]? CampaignHooks);

public record AiWorkerChatRequest(
    Guid CampaignId,
    Guid ConversationId,
    string Message,
    string Mode,
    string ClientOwnerId,
    ChatContext Context,
    CampaignDto Campaign,
    IReadOnlyList<PartyCharacterDto> Party);

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
