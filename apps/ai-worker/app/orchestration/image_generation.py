import datetime as dt
import json
import os
import re
from typing import Any
from urllib.parse import quote

import httpx


IMAGE_STYLE_PRESETS = {
    "cinematic": "cinematic fantasy concept art, dramatic but readable lighting, rich environment detail",
    "parchment sketch": "ink and watercolor parchment sketch, handout-ready, restrained color wash",
    "combat stance": (
        "dynamic fantasy combat character art, action-ready pose, signature fighting method or spell effect prepared, "
        "readable silhouette, clear gear details, dramatic but table-readable motion"
    ),
    "anime": (
        "anime-inspired original fantasy illustration, expressive faces, clean linework, vibrant but readable color, "
        "dramatic composition, table-ready character or scene detail"
    ),
}

SAFE_IMAGE_PROMPT_SUFFIX = (
    "Original fantasy art only. Do not reference copyrighted characters, logos, living artists, or imitation style names. "
    "Keep all important characters, creatures, gear, faces, and scene clues fully inside the frame with comfortable edge margins. "
    "Use a pulled-back, centered composition with no subject touching the image edge and no cropped-off subjects. "
    "No readable text, no watermark, no UI, no gore."
)

SUPPORTED_IMAGE_ASPECT_RATIOS = {"1:1", "3:4", "4:3", "9:16", "16:9"}


def image_generation_enabled() -> bool:
    return str(os.getenv("IMAGE_GENERATION_ENABLED", "false")).strip().lower() in {"1", "true", "yes", "on"}


def image_provider() -> str:
    return str(os.getenv("IMAGE_PROVIDER", "mock")).strip().lower() or "mock"


def image_model_name() -> str:
    return str(os.getenv("IMAGE_MODEL", "gemini-2.5-flash-image")).strip() or "gemini-2.5-flash-image"


def image_aspect_ratio() -> str:
    ratio = str(os.getenv("IMAGE_ASPECT_RATIO", "4:3")).strip()
    return ratio if ratio in SUPPORTED_IMAGE_ASPECT_RATIOS else "4:3"


def generate_image(request: Any) -> dict[str, Any]:
    output_type = _normalize_output_type(getattr(request, "structuredOutputType", ""))
    if output_type not in {"npc", "character", "encounter"}:
        return _failed_response(request, "mock", image_model_name(), "structuredOutputType must be npc, character, or encounter.")

    prompt = build_image_prompt(output_type, getattr(request, "structuredOutputData", {}) or {}, getattr(request, "stylePreset", "cinematic"))
    provider = image_provider()

    if not image_generation_enabled():
        return _mock_response(request, prompt, status="disabled")
    if provider == "mock":
        return _mock_response(request, prompt, status="mock")
    if provider not in {"gemini", "vertex"}:
        return _failed_response(request, provider, image_model_name(), "IMAGE_PROVIDER must be mock, gemini, or vertex.")

    try:
        image_data = _generate_vertex_image(prompt) if provider == "vertex" else _generate_gemini_image(prompt)
    except RuntimeError as exc:
        return _failed_response(request, provider, image_model_name(), str(exc), image_prompt=prompt)

    return {
        "imageUrl": None,
        "imageData": image_data,
        "imagePrompt": prompt,
        "provider": provider,
        "model": image_model_name(),
        "status": "succeeded",
        "error": None,
        "imageGeneratedAt": _utc_now(),
        "imageStylePreset": _normalize_style_preset(getattr(request, "stylePreset", "cinematic")),
    }


def build_image_prompt(output_type: str, data: dict[str, Any], style_preset: str | None = None) -> str:
    style = _normalize_style_preset(style_preset)
    style_line = IMAGE_STYLE_PRESETS[style]
    if output_type == "npc":
        return _compact_prompt(
            "Create portrait-style fantasy character art for a tabletop RPG NPC. "
            f"Style preset: {style_line}. "
            f"Name or archetype: {_safe_text(data.get('name'), 'Generated NPC')}. "
            f"Role: {_safe_text(data.get('role'), 'campaign NPC')}. "
            f"Ancestry/species: {_safe_text(data.get('raceOrSpecies'), 'fantasy humanoid')}. "
            f"Visual description: {_safe_text(data.get('description'), 'distinctive adventuring-era attire')}. "
            f"Personality shown through pose and expression: {_safe_text(data.get('personality'), 'watchful and memorable')}. "
            f"Connection mood: {_safe_text(data.get('relationshipToParty'), 'useful table ally or complication')}. "
            f"{SAFE_IMAGE_PROMPT_SUFFIX}",
            1200,
        )

    if output_type == "character":
        equipment = _safe_list(data.get("equipment"), "class gear and travel kit")
        return _compact_prompt(
            "Create portrait-style fantasy character art for a tabletop RPG playable or near-playable character. "
            f"Style preset: {style_line}. "
            f"Name or archetype: {_safe_text(data.get('name'), 'Generated Character')}. "
            f"Ancestry/species: {_safe_text(data.get('ancestryOrSpecies') or data.get('species') or data.get('raceOrSpecies'), 'fantasy humanoid')}. "
            f"Class/subclass: {_safe_text(data.get('classAndSubclass') or data.get('className'), 'adventurer')}. "
            f"Level and role: level {_safe_text(data.get('level'), '1')} {_safe_text(data.get('role'), 'table-ready adventurer')}. "
            f"Background: {_safe_text(data.get('background'), 'campaign-tied wanderer')}. "
            f"Personality shown through pose and expression: {_safe_list(data.get('personalityTraits'), 'practical, capable, and memorable')}. "
            f"Equipment to show: {equipment}. "
            f"{_combat_equipment_constraint(data, equipment)}"
            f"Campaign mood: {_safe_text(data.get('campaignTieIn'), 'connected to the current campaign without revealing hidden secrets')}. "
            f"{SAFE_IMAGE_PROMPT_SUFFIX}",
            1200,
        )

    monsters = _monster_summary(data.get("monsters"))
    return _compact_prompt(
        "Create cinematic fantasy scene or environment art for a tabletop RPG encounter. "
        f"Style preset: {style_line}. "
        f"Encounter: {_safe_text(data.get('title'), 'Generated Encounter')}. "
        f"Difficulty mood: {_safe_text(data.get('difficulty'), 'tense')}. "
        f"Environment: {_safe_text(data.get('environment'), 'dramatic fantasy battlefield')}. "
        f"Opposition: {monsters}. "
        f"Action and tactics: {_safe_text(data.get('tactics'), 'the scene should imply imminent danger and tactical choices')}. "
        f"Rewards or visual clues: {_safe_list(data.get('rewards'), 'subtle clues or treasure details')}. "
        f"{SAFE_IMAGE_PROMPT_SUFFIX}",
        1200,
    )


def _generate_gemini_image(prompt: str) -> str:
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is required when IMAGE_GENERATION_ENABLED=true and IMAGE_PROVIDER=gemini.")

    model = image_model_name()
    model_path = model if model.startswith("models/") else f"models/{model}"
    url = f"https://generativelanguage.googleapis.com/v1beta/{model_path}:generateContent"
    payload = _image_generate_content_payload(prompt)

    try:
        response = httpx.post(
            url,
            headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
            json=payload,
            timeout=float(os.getenv("IMAGE_TIMEOUT_SECONDS", os.getenv("GEMINI_TIMEOUT_SECONDS", "60"))),
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        detail = _safe_error_detail(exc.response)
        raise RuntimeError(f"Gemini image request failed with HTTP {exc.response.status_code}: {detail}") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Gemini image request failed: {exc}") from exc

    image_data = _extract_image_data_url(response.json())
    if not image_data:
        raise RuntimeError("Gemini image response did not include image data.")
    return image_data


def _generate_vertex_image(prompt: str) -> str:
    url = _vertex_image_endpoint()
    token = _vertex_access_token()
    payload = _image_generate_content_payload(prompt)

    try:
        response = httpx.post(
            url,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
            json=payload,
            timeout=float(os.getenv("IMAGE_TIMEOUT_SECONDS", os.getenv("VERTEX_TIMEOUT_SECONDS", "60"))),
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        detail = _safe_error_detail(exc.response)
        raise RuntimeError(f"Vertex image request failed with HTTP {exc.response.status_code}: {detail}") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Vertex image request failed: {exc}") from exc

    image_data = _extract_image_data_url(response.json())
    if not image_data:
        raise RuntimeError("Vertex image response did not include image data.")
    return image_data


def _image_generate_content_payload(prompt: str) -> dict[str, Any]:
    return {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}],
            }
        ],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {"aspectRatio": image_aspect_ratio()},
        },
    }


def _vertex_image_endpoint() -> str:
    project_id = str(os.getenv("VERTEX_PROJECT_ID") or "").strip()
    if not project_id:
        raise RuntimeError("VERTEX_PROJECT_ID is required when IMAGE_GENERATION_ENABLED=true and IMAGE_PROVIDER=vertex.")

    location = str(os.getenv("VERTEX_LOCATION") or "global").strip()
    if not location:
        raise RuntimeError("VERTEX_LOCATION is required when IMAGE_GENERATION_ENABLED=true and IMAGE_PROVIDER=vertex.")

    model = _vertex_image_model_id()
    base_url = "https://aiplatform.googleapis.com/v1" if location == "global" else f"https://{location}-aiplatform.googleapis.com/v1"
    return (
        f"{base_url}/projects/{quote(project_id, safe='')}/locations/{quote(location, safe='')}/"
        f"publishers/google/models/{quote(model, safe='')}:generateContent"
    )


def _vertex_image_model_id() -> str:
    model = image_model_name()
    for prefix in ("publishers/google/models/", "models/"):
        if model.startswith(prefix):
            return model[len(prefix) :]
    return model


def _vertex_access_token() -> str:
    try:
        import google.auth
        from google.auth.transport.requests import Request
    except ImportError as exc:
        raise RuntimeError("google-auth is required when IMAGE_PROVIDER=vertex.") from exc

    try:
        credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        if not getattr(credentials, "valid", False) or not getattr(credentials, "token", None):
            credentials.refresh(Request())
        token = getattr(credentials, "token", None)
        if not token:
            raise RuntimeError("Application Default Credentials did not return an access token.")
        return str(token)
    except Exception as exc:
        raise RuntimeError(f"Vertex ADC authentication failed: {exc}") from exc


def _extract_image_data_url(payload: dict[str, Any]) -> str | None:
    for candidate in payload.get("candidates") or []:
        content = candidate.get("content") or {}
        for part in content.get("parts") or []:
            inline_data = part.get("inlineData") or part.get("inline_data")
            if not isinstance(inline_data, dict):
                continue
            data = str(inline_data.get("data") or "").strip()
            mime_type = str(inline_data.get("mimeType") or inline_data.get("mime_type") or "image/png").strip()
            if data:
                return f"data:{mime_type};base64,{data}"
    return None


def _mock_response(request: Any, prompt: str, status: str) -> dict[str, Any]:
    output_type = _normalize_output_type(getattr(request, "structuredOutputType", "npc"))
    title = _image_title(output_type, getattr(request, "structuredOutputData", {}) or {})
    style = _normalize_style_preset(getattr(request, "stylePreset", "cinematic"))
    return {
        "imageUrl": _mock_svg_data_url(output_type, title, style),
        "imageData": None,
        "imagePrompt": prompt,
        "provider": "mock",
        "model": image_model_name(),
        "status": status,
        "error": None,
        "imageGeneratedAt": _utc_now(),
        "imageStylePreset": style,
    }


def _failed_response(request: Any, provider: str, model: str, error: str, image_prompt: str | None = None) -> dict[str, Any]:
    style = _normalize_style_preset(getattr(request, "stylePreset", "cinematic"))
    return {
        "imageUrl": None,
        "imageData": None,
        "imagePrompt": image_prompt or "",
        "provider": provider,
        "model": model,
        "status": "failed",
        "error": _friendly_image_error(error),
        "imageGeneratedAt": None,
        "imageStylePreset": style,
    }


def _mock_svg_data_url(output_type: str, title: str, style: str) -> str:
    accent = "#b86b2f" if output_type == "npc" else ("#6f5aa8" if output_type == "character" else "#3f6f63")
    label = "NPC PORTRAIT" if output_type == "npc" else ("CHARACTER PORTRAIT" if output_type == "character" else "ENCOUNTER SCENE")
    svg = f"""
    <svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
      <rect width="960" height="540" fill="#f1eadb"/>
      <rect x="36" y="36" width="888" height="468" rx="18" fill="#20312d"/>
      <path d="M90 392 C210 244 326 344 438 206 C548 72 662 222 870 118 L870 444 L90 444 Z" fill="{accent}" opacity="0.72"/>
      <circle cx="724" cy="142" r="58" fill="#e8c16b" opacity="0.9"/>
      <text x="84" y="104" fill="#f8f1e2" font-family="Georgia, serif" font-size="30" font-weight="700">{_xml_escape(label)}</text>
      <text x="84" y="152" fill="#d8e2dc" font-family="Arial, sans-serif" font-size="22">{_xml_escape(title[:64])}</text>
      <text x="84" y="444" fill="#f8f1e2" font-family="Arial, sans-serif" font-size="18">{_xml_escape(style.title())} mock image</text>
    </svg>
    """
    return "data:image/svg+xml;utf8," + quote(re.sub(r"\s+", " ", svg).strip(), safe=":/;,=%")


def _image_title(output_type: str, data: dict[str, Any]) -> str:
    fallback = "Generated NPC" if output_type == "npc" else ("Generated Character" if output_type == "character" else "Generated Encounter")
    return _safe_text(data.get("name") or data.get("title"), fallback)


def _monster_summary(value: Any) -> str:
    if not isinstance(value, list):
        return "fantasy opposition implied by the scene"
    monsters = []
    for item in value[:6]:
        if isinstance(item, dict):
            name = _safe_text(item.get("name"), "creature")
            count = _safe_text(item.get("count"), "1")
            role = _safe_text(item.get("role"), "combatant")
            monsters.append(f"{count} {name} ({role})")
        elif str(item).strip():
            monsters.append(_safe_text(item, "creature"))
    return "; ".join(monsters) if monsters else "fantasy opposition implied by the scene"


def _safe_list(value: Any, fallback: str) -> str:
    if not isinstance(value, list):
        return fallback
    items = [_safe_text(item, "") for item in value[:5]]
    items = [item for item in items if item]
    return "; ".join(items) if items else fallback


def _combat_equipment_constraint(data: dict[str, Any], equipment_text: str) -> str:
    visual_text = " ".join(
        _safe_text(value, "")
        for value in [
            equipment_text,
            data.get("statSummary"),
            data.get("role"),
            data.get("classAndSubclass"),
            data.get("description"),
        ]
    ).lower()
    if re.search(r"\b(gauntlets?|unarmed|fists?|hand[- ]to[- ]hand|pugilist|brawler)\b", visual_text):
        return "Combat method: unarmed or gauntlet-based; show empty hands or armored fists, and do not add swords, axes, polearms, bows, or other held weapons. "
    return "Combat method: follow the listed equipment only; do not invent extra held weapons. "


def _safe_text(value: Any, fallback: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    text = re.sub(r"\bsecret\b\s*:?.*$", "", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"[<>]", "", text)
    return text[:220] if text else fallback


def _compact_prompt(value: str, max_length: int) -> str:
    compact = re.sub(r"\s+", " ", value).strip()
    return compact if len(compact) <= max_length else compact[:max_length].rstrip() + "."


def _normalize_output_type(value: Any) -> str:
    return str(value or "").strip().lower()


def _normalize_style_preset(value: Any) -> str:
    normalized = str(value or "cinematic").strip().lower().replace("_", " ")
    return normalized if normalized in IMAGE_STYLE_PRESETS else "cinematic"


def _utc_now() -> str:
    return dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")


def _xml_escape(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _friendly_image_error(message: str) -> str:
    lower = message.lower()
    if "api_key" in lower or "api key" in lower:
        return "Image generation is not connected correctly. Ask the app admin to check the Gemini API key."
    if "adc" in lower or "application default credentials" in lower or "google-auth" in lower:
        return "Vertex image generation is not connected correctly. Ask the app admin to check the ADC setup."
    if "429" in lower or "quota" in lower or "rate limit" in lower:
        return "Image generation is getting too many requests right now. Please wait a moment, then try again."
    if "503" in lower or "service unavailable" in lower or "overloaded" in lower:
        return "Image generation is busy right now. Please try again in a moment."
    if "did not include image data" in lower or "malformed" in lower:
        return "Gemini did not return a usable image. Try a simpler visual prompt."
    return "DNDMind could not generate an image just now. Please try again."


def _safe_error_detail(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return response.text[:500]

    error = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(error, dict):
        return str(error.get("message") or error.get("status") or "Unknown image generation error")
    return json.dumps(payload, default=str)[:500]
