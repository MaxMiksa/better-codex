"""Installation identity and stable state/content roots."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SETTINGS = ROOT / '.runtime/token-hud/embedded/settings.json'
STATE = SETTINGS.parent / 'runtime'
PROMPT_CONTENT = ROOT / 'prompts/model_instructions_file'
