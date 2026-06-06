import re
import unicodedata


MAX_UPLOAD_CHARACTERS = 2_000_000
MAX_UPLOAD_CHUNKS = 400

SCRIPT_BLOCK_RE = re.compile(r"<\s*(script|style)\b[^>]*>.*?<\s*/\s*\1\s*>", re.IGNORECASE | re.DOTALL)
HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
HTML_TAG_RE = re.compile(r"<[^>\n]{1,500}>")


def sanitize_uploaded_text(text: str) -> str:
    """Treat uploaded campaign knowledge as untrusted plain text before indexing."""
    capped = text[:MAX_UPLOAD_CHARACTERS]
    without_controls = "".join(
        char
        for char in capped
        if char in "\n\r\t" or not unicodedata.category(char).startswith("C")
    )
    normalized = without_controls.replace("\r\n", "\n").replace("\r", "\n")
    normalized = SCRIPT_BLOCK_RE.sub(" ", normalized)
    normalized = HTML_COMMENT_RE.sub(" ", normalized)
    normalized = HTML_TAG_RE.sub(" ", normalized)
    return normalized.replace("<", "[").replace(">", "]").strip()
