"""Spec lookup: research an instrument's specs on the web with Claude, then map them onto the app's spec form.

Two calls:
  1. Research - Claude with web search + web fetch writes up the factory specs with sources.
  2. Extract  - Claude turns those notes into JSON constrained to the form's exact option values
                (schema built from data/options.json), flagging every guessed or inferred field.
"""
import json
import os
from pathlib import Path

try:
    import anthropic
except ImportError:  # the rest of the app works without it
    anthropic = None

MODEL = "claude-opus-5-5"
BETAS = ["server-side-fallback-2026-07-01"]  # re-run on another model if a request is declined
OPTIONS_FILE = Path(__file__).parent / "data" / "options.json"

with open(OPTIONS_FILE) as f:
    SHARED = json.load(f)
OPT = SHARED["OPTIONS"]
NOT_SURE = SHARED["NOT_SURE"]


class LookupError_(Exception):
    """A lookup failure with a message that's safe to show the user."""


def available():
    """True when the SDK is installed and some credential is likely configured."""
    if anthropic is None:
        return False
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        return True
    return (Path.home() / ".config" / "anthropic").exists()  # `ant auth login` profile


# ---------- schema ----------

def _values(key, type_):
    lst = OPT[key][type_] if isinstance(OPT[key], dict) else OPT[key]
    return [o[0] for o in lst if len(o) < 3 or type_ in o[2]]


def _enum(key, type_, desc):
    vals = _values(key, type_)
    if all(isinstance(v, int) for v in vals):
        return {"type": "integer", "enum": vals, "description": desc}
    return {"type": "string", "enum": [str(v) for v in vals], "description": desc}


def _str(desc):
    return {"type": "string", "description": desc}


def _int_or_null(desc):
    return {"anyOf": [{"type": "integer"}, {"type": "null"}], "description": desc}


def spec_fields(type_):
    f = {
        "strings": _enum("strings", type_, "Number of strings"),
        "scale": _enum("scale", type_, "Scale length bucket"),
        "radius": _enum("radius", type_, "Fingerboard radius; pick the nearest listed value"),
        "fbMaterial": _enum("fbMaterial", type_, "Fingerboard wood"),
        "fbFinish": _enum("fbFinish", type_, "Is the fingerboard clear-coated? Maple boards are usually finished; rosewood, ebony, laurel, walnut, jatoba, pau ferro are bare"),
        "frets": _int_or_null("Number of frets, null if not found"),
        "fretSize": _enum("fretSize", type_, "Fret wire size"),
        "fretMaterial": _enum("fretMaterial", type_, "Fret material; nickel unless stated otherwise"),
        "nut": _enum("nut", type_, "Nut material or type"),
        "neckJoint": _enum("neckJoint", type_, "How the neck attaches"),
        "trussAccess": _enum("trussAccess", type_, "Where the truss rod is adjusted"),
        "trussTool": _str("Truss rod wrench size if published (e.g. '4 mm hex'), else empty"),
        "gauge": _str("Factory string gauge, lightest-heaviest, e.g. '10-46' or '12-53 (light)'; empty if not found"),
        "tuning": _str("Factory tuning, e.g. 'E standard'"),
        "bodyWood": _str("Body woods in a few words, e.g. 'Spruce top, nato back & sides'"),
        "bodyFinish": _enum("finish", type_, "Body finish"),
        "neckFinish": _enum("finish", type_, "Neck finish"),
    }
    if type_ == "electric":
        f.update({
            "bridgeType": _enum("bridgeElectric", type_, "Bridge type"),
            "bridgeModel": _str("Bridge model name if published, else empty"),
            "tremSetup": _enum("tremSetup", type_, "Factory tremolo setup; 'floating' for most locking trems and modern 2-point trems"),
            "springs": _int_or_null("Number of trem springs, null if no trem or unknown"),
            "lockingTuners": _enum("yesNo", type_, "Locking tuners"),
            "pickups": _enum("pickupsElectric", type_, "Pickup layout, bridge to neck"),
            "pickupNotes": _str("Pickup model names if published, else empty"),
            "active": _enum("yesNo", type_, "Active electronics"),
            "battery": _enum("battery", type_, "Battery type; 'none' for passive"),
        })
    elif type_ == "acoustic":
        f.update({
            "stringType": _enum("stringType", type_, "Steel or nylon"),
            "top": _enum("top", type_, "Top construction"),
            "bridgeAcoustic": _enum("bridgeAcoustic", type_, "Bridge style"),
            "saddle": _enum("saddle", type_, "Saddle material; Urea/Tusq/Micarta/Nubone count as synthetic"),
            "electronics": _enum("electronicsAcoustic", type_, "Pickup system"),
            "battery": _enum("battery", type_, "Preamp battery type; 'none' if no electronics"),
        })
    else:
        f.update({
            "bridgeType": _enum("bridgeBass", type_, "Bridge type"),
            "bridgeModel": _str("Bridge model name if published, else empty"),
            "stringLoad": _enum("stringLoad", type_, "Top-load, through-body, or both"),
            "fretted": _enum("fretted", type_, "Fretted or fretless"),
            "pickups": _enum("pickupsBass", type_, "Pickup layout"),
            "pickupNotes": _str("Pickup model names if published, else empty"),
            "active": _enum("yesNo", type_, "Active electronics"),
            "battery": _enum("battery", type_, "Battery type; 'none' for passive"),
            "bassStringType": _enum("bassStringType", type_, "Factory string type"),
        })
    return f


def schema(type_):
    fields = spec_fields(type_)
    spec = {"type": "object", "properties": fields, "required": list(fields), "additionalProperties": False}
    return {
        "type": "object",
        "properties": {
            "found": {"type": "boolean", "description": "True if specs for this specific model (not just the brand) were found"},
            "make": _str("Manufacturer, e.g. 'Yamaha'"),
            "model": _str("Model name as the maker writes it, e.g. 'APX500III'"),
            "year": _str("Production years these specs apply to, e.g. '2015–2020', or empty"),
            "spec": spec,
            "uncertain": {"type": "array", "items": {"type": "string", "enum": list(fields)},
                          "description": "Every spec field that was guessed, inferred from similar models, or conflicted between sources"},
            "notes": _str("One to three short sentences for the player: variants, year changes, anything to double-check"),
            "source_urls": {"type": "array", "items": {"type": "string"}, "description": "URLs of the pages the specs came from"},
        },
        "required": ["found", "make", "model", "year", "spec", "uncertain", "notes", "source_urls"],
        "additionalProperties": False,
    }


# ---------- Claude calls ----------

LABELS = {"electric": "electric guitar", "acoustic": "acoustic guitar", "bass": "electric bass"}

RESEARCH_SYSTEM = (
    "You research musical instrument specifications for a guitar setup app. Find the factory specs for the "
    "exact model the user names, using the manufacturer's spec page first, then reputable retailer spec "
    "listings. Cover: strings and factory gauge, scale length, fingerboard material and radius, fret count, "
    "size and material, nut, neck joint, truss rod adjustment location, bridge type and model, tremolo, "
    "saddle, pickups and electronics (active/passive, preamp, battery), body and neck woods, body and neck "
    "finish. If the name matches several variants or generations (e.g. II vs III), say which one you used "
    "and how the others differ. Mark anything you inferred rather than read. Be concise: a spec list with "
    "the source URL for each group of specs."
)


def _client():
    if anthropic is None:
        raise LookupError_("Spec lookup needs the anthropic package: pip install -r requirements.txt")
    return anthropic.Anthropic()


def _create(client, **kw):
    """One request, translating SDK errors into messages the user can act on."""
    try:
        return client.beta.messages.create(model=MODEL, betas=BETAS, fallbacks="default", **kw)
    except anthropic.AuthenticationError:
        raise LookupError_("The Claude API key was rejected. Check ANTHROPIC_API_KEY on the computer running the server.")
    except anthropic.PermissionDeniedError:
        raise LookupError_("This API key can't use web search. Enable web search for your organization in the Claude Console.")
    except anthropic.RateLimitError:
        raise LookupError_("Rate limited by the Claude API. Try again in a minute.")
    except anthropic.BadRequestError as e:
        raise LookupError_(f"The lookup request was rejected: {e.message}")
    except anthropic.APIStatusError as e:
        raise LookupError_(f"The Claude API returned an error ({e.status_code}). Try again shortly.")
    except anthropic.APIConnectionError:
        raise LookupError_("Couldn't reach the Claude API. Check the server's internet connection.")


def _check_stop(resp):
    if resp.stop_reason == "refusal":
        raise LookupError_("The lookup was declined. Enter the specs yourself instead.")


def research(client, type_, query):
    messages = [{"role": "user", "content": f"Instrument type: {LABELS[type_]}\nModel: {query}"}]
    tools = [
        {"type": "web_search_20260209", "name": "web_search", "max_uses": 6},
        {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 4},
    ]
    blocks = []
    for _ in range(5):  # the server-side tool loop can pause; resume a bounded number of times
        resp = _create(client, max_tokens=16000, system=RESEARCH_SYSTEM, tools=tools,
                       output_config={"effort": "medium"}, messages=messages)
        _check_stop(resp)
        blocks.extend(resp.content)
        if resp.stop_reason != "pause_turn":
            break
        messages = [messages[0], {"role": "assistant", "content": resp.content}]

    notes = "\n".join(b.text for b in blocks if b.type == "text").strip()
    sources = {}
    for b in blocks:
        if b.type == "web_search_tool_result" and isinstance(b.content, list):  # an error result is an object
            for r in b.content:
                if getattr(r, "url", None):
                    sources[r.url] = getattr(r, "title", "") or r.url
        elif b.type == "web_fetch_tool_result":
            url = getattr(b.content, "url", None)
            if url:
                sources.setdefault(url, url)
    if not notes:
        raise LookupError_("The search didn't return anything usable. Enter the specs yourself instead.")
    return notes, sources


def extract(client, type_, query, notes):
    prompt = (
        f"The player owns a {LABELS[type_]} they call \"{query}\". Below are research notes on its factory specs.\n"
        "Fill in the spec form. Choose the closest listed option for every field. Where the notes don't say, "
        "give your best estimate from what's typical for this maker, series and price point, and list that field "
        f"in `uncertain`. Use '{NOT_SURE}' only when you genuinely can't estimate. Also list in `uncertain` "
        "anything that differs between variants or years.\n\n"
        f"<research_notes>\n{notes}\n</research_notes>"
    )
    resp = _create(client, max_tokens=8000, messages=[{"role": "user", "content": prompt}],
                   output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema(type_)}})
    _check_stop(resp)
    if resp.stop_reason == "max_tokens":
        raise LookupError_("The lookup response was cut off. Try again.")
    text = next((b.text for b in resp.content if b.type == "text"), "")
    return json.loads(text)


def lookup(type_, query, client=None):
    if type_ not in LABELS:
        raise LookupError_("Unknown instrument type.")
    query = " ".join(str(query).split())[:120]
    if not query:
        raise LookupError_("Type a make and model to look up.")
    client = client or _client()
    notes, seen = research(client, type_, query)
    data = extract(client, type_, query, notes)
    # Only keep source links that actually came back from search/fetch.
    data["sources"] = [{"url": u, "title": seen[u]} for u in data.pop("source_urls", []) if u in seen][:8]
    data["query"] = query
    return data
