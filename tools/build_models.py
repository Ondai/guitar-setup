"""Builds data/models.json, the starter model library.

Sources:
  sheet   - the owner's Instrument Info sheet (their actual instruments)
  catalog - typical factory specs for popular models, written from general knowledge;
            specs change by year and region, so fields we're less sure of go in `verify`
Run:  python3 tools/build_models.py
"""
import json
import re
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "models.json"
U = "unsure"

def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")

def fb_finish(mat):
    return "finished" if mat == "maple" else ("unfinished" if mat not in (U,) else U)

E_BASE = dict(strings=6, scale="25.5", radius=U, frets=22, fretSize=U, fretMaterial="nickel", fbMaterial=U, nut=U,
              neckJoint="bolt-on", trussAccess=U, trussTool="", gauge="", tuning="E standard", bodyWood="",
              bodyFinish="gloss-poly", neckFinish=U, bridgeType="other", bridgeModel="", tremSetup="floating", springs=3,
              lockingTuners="no", pickups="other", pickupNotes="", active="no", battery="none")
A_BASE = dict(strings=6, scale=U, radius=U, frets=20, fretSize="medium", fretMaterial="nickel", fbMaterial=U, nut=U,
              neckJoint="set", trussAccess=U, trussTool="", gauge="", tuning="E standard", bodyWood="",
              bodyFinish="gloss-poly", neckFinish=U, stringType="steel", top=U, bridgeAcoustic="pinned", saddle=U,
              electronics="none", battery="none")
B_BASE = dict(strings=4, scale="34", radius=U, frets=20, fretSize=U, fretMaterial="nickel", fbMaterial=U, nut=U,
              neckJoint="bolt-on", trussAccess=U, trussTool="", gauge="", tuning="EADG standard", bodyWood="",
              bodyFinish="gloss-poly", neckFinish=U, bridgeType="other", bridgeModel="", stringLoad=U, fretted="fretted",
              pickups="other", pickupNotes="", active="no", battery="none", bassStringType="round")
BASE = {"electric": E_BASE, "acoustic": A_BASE, "bass": B_BASE}

MODELS = []

def add(type_, make, model, spec, verify=(), source="catalog", aliases=(), note=""):
    s = {**BASE[type_], **spec}
    if "fbFinish" not in spec:
        s["fbFinish"] = fb_finish(s["fbMaterial"])
    unknown = [k for k in s if k not in BASE[type_] and k not in ("fbFinish", "scaleCustom", "scaleMulti", "year")]
    assert not unknown, (model, unknown)
    MODELS.append(dict(id=slug(f"{make} {model}"), type=type_, make=make, model=model, aliases=list(aliases),
                       source=source, spec=s, verify=sorted(set(verify)), note=note))

# ---------------- the owner's instruments (Instrument Info sheet) ----------------
SHEET_NOTE = "From your Instrument Info sheet; other fields are typical for the model."

add("electric", "Ibanez", "RG550 Genesis", dict(
    year="2020", scale="25.5", radius="16.9", frets=24, fretSize="jumbo", fbMaterial="maple", fbFinish="finished",
    nut="locking", trussAccess="headstock", trussTool="4 mm hex", bridgeType="trem-locking", bridgeModel="Ibanez Edge",
    pickups="HSH", pickupNotes="DiMarzio Evolution (upgraded)", gauge="9-42", bodyWood="Basswood",
    bodyFinish="gloss-poly", neckFinish="satin-poly"),
    source="sheet", aliases=["rg550", "rg 550", "genesis"],
    note="From your Instrument Info sheet and RG550 setup guide. Sheet lists a 17\" radius; Ibanez specs it as 430 mm (16.9\").")

add("electric", "Charvel", "Vivaldi DK-24 Nova (7-string)", dict(
    strings=7, scale="25.5", radius="c-12-16", frets=24, fretSize="jumbo", fbMaterial="maple", fbFinish="finished",
    bridgeType="trem-2point", bridgeModel="Gotoh 510 (7-string)", tuning="B standard (7-string)", gauge="9-54",
    trussAccess="spoke", pickups="HH", nut="synthetic", neckFinish="satin-poly"),
    verify=["trussAccess", "pickups", "nut", "neckFinish", "bodyFinish"], source="sheet",
    aliases=["dk24", "dk-24", "vivaldi", "nova", "charvel 7"], note=SHEET_NOTE)

add("electric", "Jackson", "DK2 (Japan, ~2006)", dict(
    year="~2006", scale="25.5", radius="c-12-16", frets=24, fretSize="jumbo", fbMaterial="rosewood",
    bridgeType="trem-locking", bridgeModel="Jackson JT580-LP", nut="locking", tuning="C standard", gauge="11-56",
    pickups="HH"),
    verify=["pickups", "trussAccess", "neckFinish", "frets"], source="sheet",
    aliases=["dk2", "dk-2", "dinky"], note=SHEET_NOTE + " The sheet has two DK2s (blue and red Eerie Dess Swirl) — add each one.")

add("electric", "Strandberg", "Boden Original 7", dict(
    year="2018", strings=7, scale="multi", scaleMulti="26.25-25.5", radius="20", frets=24, fretSize="medium-jumbo",
    fretMaterial="stainless", fbMaterial="roasted-maple", fbFinish="unfinished", bridgeType="headless",
    bridgeModel="Strandberg EGS Rev 7", tuning="B standard (7-string)", pickups="HH",
    pickupNotes="Bare Knuckle Polymath", bodyWood="Flame maple top", neckFinish="oil"),
    verify=["fretSize", "bridgeModel", "trussAccess", "neckFinish", "bodyFinish", "gauge"], source="sheet",
    aliases=["boden", "strandberg 7", "boden 7"], note=SHEET_NOTE + " Frets are Jescar 51100 stainless.")

add("electric", "HILS", "NEXT HN6", dict(
    year="2026", scale="25.5", radius="c-12-16", fbMaterial="rosewood", fretMaterial="stainless",
    bridgeType="other", bridgeModel="Alchemy tremolo", gauge="10-46"),
    verify=["frets", "fretSize", "bridgeType", "pickups", "trussAccess"], source="sheet",
    aliases=["hils", "next", "hn6"], note=SHEET_NOTE + " Not much published about this one — fill in the rest from the guitar.")

add("bass", "Warwick", "Corvette $$ (5-string)", dict(
    strings=5, scale="34", fbMaterial="wenge", fbFinish="unfinished", fretSize="jumbo",
    bridgeType="other", bridgeModel="Warwick 2-piece bridge", tuning="Custom (A D A D G)", gauge="45-135",
    pickups="HH", pickupNotes="MEC J/J humbuckers", active="yes", battery="9v", bodyFinish="oil", neckFinish="oil",
    trussAccess="headstock", nut="synthetic"),
    verify=["fbMaterial", "active", "battery", "nut", "frets", "bodyFinish"], source="sheet",
    aliases=["corvette", "$$", "double buck"],
    note=SHEET_NOTE)

add("bass", "Cort", "Artisan Space 4", dict(
    strings=4, scale="34", radius="15.75", fbMaterial="roasted-maple", fbFinish="unfinished", fretSize="medium-jumbo",
    bridgeType="headless", bridgeModel="Cort headless bridge", gauge="45-105", pickups="HH", active="yes", battery="9v"),
    verify=["pickups", "active", "battery", "frets", "trussAccess", "neckJoint"], source="sheet",
    aliases=["space", "artisan space", "space 4"], note=SHEET_NOTE)

add("acoustic", "Takamine", "EAN10C", dict(
    scale="other", scaleCustom="25.375", fbMaterial="rosewood", bridgeAcoustic="pinless", tuning="DADGAD",
    gauge="13-56 (medium)", top="solid", electronics="piezo", battery="9v", saddle="synthetic", trussAccess="headstock"),
    verify=["top", "battery", "saddle", "trussAccess", "frets"], source="sheet",
    aliases=["ean10", "ean10c", "takamine nex"], note=SHEET_NOTE + " Strings per the sheet: Try True Medium 13-56, tuned DADGAD.")

add("acoustic", "Yamaha", "APX500II", dict(
    scale="other", scaleCustom="25", fbMaterial="rosewood", frets=22, top="laminate", bodyWood="Spruce top, nato back & sides",
    bridgeAcoustic="pinned", saddle="synthetic", nut="synthetic", electronics="piezo", gauge="12-53 (light)",
    trussAccess="soundhole"),
    verify=["battery", "trussAccess", "frets", "saddle"], aliases=["apx500", "apx 500", "apx500ii", "apx"],
    note="Thinline cutaway with a System 65A preamp. Scale length is 25\" per your spec sheet.")

# ---------------- popular electrics ----------------
add("electric", "Fender", "Player Stratocaster", dict(
    radius="9.5", fretSize="medium-jumbo", fbMaterial="maple", nut="synthetic", trussAccess="headstock",
    bridgeType="trem-2point", bridgeModel="Fender 2-Point Synchronized", pickups="SSS", gauge="9-42",
    bodyWood="Alder", neckFinish="satin-poly"),
    verify=["trussAccess"], aliases=["strat", "stratocaster", "player strat", "player ii strat"])
add("electric", "Fender", "American Professional II Stratocaster", dict(
    radius="9.5", fretSize="narrow-tall", fbMaterial="maple", nut="bone", trussAccess="headstock",
    bridgeType="trem-2point", bridgeModel="Fender 2-Point Synchronized", pickups="SSS", gauge="9-42",
    bodyWood="Alder", neckFinish="satin-poly"),
    verify=["trussAccess"], aliases=["american professional", "am pro", "ampro strat"])
add("electric", "Fender", "American Vintage II 1957 Stratocaster", dict(
    radius="7.25", frets=21, fretSize="vintage", fbMaterial="maple", nut="bone", trussAccess="heel",
    bridgeType="trem-vintage", bridgeModel="Fender Vintage Synchronized", pickups="SSS", gauge="9-42",
    bodyWood="Alder", bodyFinish="nitro", neckFinish="nitro"),
    verify=["gauge"], aliases=["av ii", "avii", "american vintage", "57 strat"])
add("electric", "Squier", "Classic Vibe '50s Stratocaster", dict(
    radius="9.5", frets=21, fretSize="narrow-tall", fbMaterial="maple", nut="bone", bridgeType="trem-vintage",
    bridgeModel="Vintage-style synchronized", pickups="SSS", gauge="9-42", bodyWood="Pine", neckFinish="gloss-poly"),
    verify=["trussAccess", "bodyWood"], aliases=["classic vibe", "cv strat", "squier cv"])
add("electric", "Squier", "Affinity Stratocaster", dict(
    radius="9.5", frets=21, fretSize="medium-jumbo", fbMaterial="maple", nut="synthetic", bridgeType="trem-2point",
    pickups="SSS", gauge="9-42", bodyWood="Poplar", neckFinish="satin-poly"),
    verify=["trussAccess", "pickups", "bodyWood"], aliases=["affinity strat"])
add("electric", "Fender", "Player Telecaster", dict(
    radius="9.5", fretSize="medium-jumbo", fbMaterial="maple", nut="synthetic", trussAccess="headstock",
    bridgeType="tele-modern", pickups="SS", gauge="9-42", bodyWood="Alder", neckFinish="satin-poly"),
    verify=["trussAccess"], aliases=["tele", "telecaster", "player tele"])
add("electric", "Fender", "American Professional II Telecaster", dict(
    radius="9.5", fretSize="narrow-tall", fbMaterial="maple", nut="bone", trussAccess="headstock",
    bridgeType="tele-vintage", bridgeModel="Top-load/string-through, 3 compensated brass saddles", pickups="SS",
    gauge="9-42", bodyWood="Alder", neckFinish="satin-poly"),
    verify=["trussAccess", "gauge"], aliases=["ampro tele", "american professional tele"])
add("electric", "Gibson", "Les Paul Standard '50s", dict(
    scale="24.75", radius="12", fretSize="medium-jumbo", fbMaterial="rosewood", nut="synthetic", neckJoint="set",
    trussAccess="headstock", trussTool="5/16\" nut driver", bridgeType="tom-stopbar", bridgeModel="Gibson ABR-1",
    pickups="HH", pickupNotes="Burstbucker 1 & 2", gauge="10-46", bodyWood="Mahogany, maple top",
    bodyFinish="nitro", neckFinish="nitro"),
    aliases=["les paul", "lp standard", "les paul standard", "lp 50s"])
add("electric", "Gibson", "Les Paul Standard '60s", dict(
    scale="24.75", radius="12", fretSize="medium-jumbo", fbMaterial="rosewood", nut="synthetic", neckJoint="set",
    trussAccess="headstock", trussTool="5/16\" nut driver", bridgeType="tom-stopbar", bridgeModel="Gibson ABR-1",
    pickups="HH", pickupNotes="Burstbucker 61R & 61T", gauge="10-46", bodyWood="Mahogany, maple top",
    bodyFinish="nitro", neckFinish="nitro"),
    aliases=["lp 60s"])
add("electric", "Gibson", "Les Paul Studio", dict(
    scale="24.75", radius="12", fretSize="medium-jumbo", fbMaterial="rosewood", nut="synthetic", neckJoint="set",
    trussAccess="headstock", trussTool="5/16\" nut driver", bridgeType="tom-stopbar", bridgeModel="Gibson Nashville",
    pickups="HH", gauge="10-46", bodyWood="Mahogany, maple top", bodyFinish="nitro", neckFinish="nitro"),
    verify=["bodyFinish"], aliases=["lp studio"])
add("electric", "Gibson", "SG Standard", dict(
    scale="24.75", radius="12", fretSize="medium-jumbo", fbMaterial="rosewood", nut="synthetic", neckJoint="set",
    trussAccess="headstock", trussTool="5/16\" nut driver", bridgeType="tom-stopbar", bridgeModel="Gibson Nashville",
    pickups="HH", gauge="10-46", bodyWood="Mahogany", bodyFinish="nitro", neckFinish="nitro"),
    aliases=["sg"])
add("electric", "Gibson", "ES-335", dict(
    scale="24.75", radius="12", fretSize="medium-jumbo", fbMaterial="rosewood", nut="synthetic", neckJoint="set",
    trussAccess="headstock", trussTool="5/16\" nut driver", bridgeType="tom-stopbar", bridgeModel="Gibson ABR-1",
    pickups="HH", gauge="10-46", bodyWood="Laminated maple/poplar/maple, semi-hollow", bodyFinish="nitro", neckFinish="nitro"),
    verify=["bridgeModel"], aliases=["335", "es335"])
add("electric", "Epiphone", "Les Paul Standard '50s", dict(
    scale="24.75", radius="12", fretSize="medium-jumbo", fbMaterial="laurel", nut="synthetic", neckJoint="set",
    trussAccess="headstock", bridgeType="tom-stopbar", bridgeModel="LockTone ABR", pickups="HH", gauge="10-46",
    bodyWood="Mahogany, maple top", neckFinish="gloss-poly"),
    verify=["trussTool"], aliases=["epiphone les paul", "epi lp"])
add("electric", "Epiphone", "SG Standard", dict(
    scale="24.75", radius="12", fretSize="medium-jumbo", fbMaterial="laurel", nut="synthetic", neckJoint="set",
    trussAccess="headstock", bridgeType="tom-stopbar", bridgeModel="LockTone", pickups="HH", gauge="10-46",
    bodyWood="Mahogany", neckFinish="gloss-poly"),
    aliases=["epi sg", "epiphone sg"])
add("electric", "PRS", "SE Custom 24", dict(
    scale="25", radius="10", frets=24, fretSize="medium-jumbo", fbMaterial="rosewood", nut="synthetic",
    trussAccess="headstock", bridgeType="trem-vintage", bridgeModel="PRS patented tremolo (molded)", pickups="HH",
    pickupNotes="85/15 \"S\"", gauge="10-46", bodyWood="Mahogany, maple top", neckFinish="satin-poly"),
    verify=["neckFinish"], aliases=["custom 24", "se custom", "ce24"])
add("electric", "PRS", "Custom 24 (Core)", dict(
    scale="25", radius="10", frets=24, fretSize="medium-jumbo", fbMaterial="rosewood", nut="synthetic", neckJoint="set",
    trussAccess="headstock", bridgeType="trem-vintage", bridgeModel="PRS Gen III", lockingTuners="yes", pickups="HH",
    pickupNotes="85/15", gauge="10-46", bodyWood="Mahogany, figured maple top", neckFinish="gloss-poly"),
    verify=["bodyFinish", "neckFinish"], aliases=["prs core", "custom 24 core"])
add("electric", "Ibanez", "RG421", dict(
    frets=24, fretSize="jumbo", radius="15.75", fbMaterial="jatoba", nut="synthetic", trussAccess="headstock",
    bridgeType="hardtail", bridgeModel="Ibanez F106", pickups="HH", gauge="9-42", bodyWood="Meranti",
    neckFinish="satin-poly"),
    verify=["radius", "fbMaterial", "bodyWood"], aliases=["rg 421"])
add("electric", "Ibanez", "AZ2204 Prestige", dict(
    radius="12", frets=22, fretSize="medium", fretMaterial="stainless", fbMaterial="roasted-maple", nut="synthetic",
    trussAccess="headstock", bridgeType="trem-2point", bridgeModel="Gotoh T1802", lockingTuners="yes", pickups="HSS",
    pickupNotes="Seymour Duncan Hyperion", gauge="10-46", bodyWood="Alder", neckFinish="oil"),
    verify=["fretSize", "gauge", "neckFinish"], aliases=["az", "az2204", "ibanez az"])
add("electric", "Jackson", "Pro Series Soloist SL2", dict(
    frets=24, fretSize="jumbo", radius="c-12-16", fbMaterial="ebony", nut="locking", neckJoint="through",
    trussAccess="spoke", bridgeType="trem-locking", bridgeModel="Floyd Rose 1000", pickups="HH",
    pickupNotes="Seymour Duncan", gauge="9-42", bodyWood="Alder wings, maple neck-through"),
    verify=["bodyWood", "gauge", "neckFinish"], aliases=["soloist", "sl2"])
add("electric", "Schecter", "Hellraiser C-1", dict(
    radius="14", frets=24, fretSize="extra-jumbo", fbMaterial="rosewood", nut="synthetic", neckJoint="set",
    trussAccess="headstock", bridgeType="tom-through", pickups="HH", pickupNotes="EMG 81/89", active="yes",
    battery="9v", gauge="10-46", bodyWood="Mahogany, quilted maple top", neckFinish="gloss-poly"),
    verify=["gauge"], aliases=["hellraiser", "c-1", "c1"])
add("electric", "ESP LTD", "EC-1000", dict(
    scale="24.75", radius="13.8", frets=24, fretSize="extra-jumbo", fbMaterial="macassar", nut="synthetic",
    neckJoint="set", trussAccess="headstock", bridgeType="tom-stopbar", bridgeModel="TonePros locking TOM + tailpiece",
    lockingTuners="yes", pickups="HH", pickupNotes="EMG 81/60 or Seymour Duncan (varies by year)", active="yes",
    battery="9v", gauge="10-46", bodyWood="Mahogany", neckFinish="gloss-poly"),
    verify=["active", "battery", "pickupNotes"], aliases=["ec1000", "ec 1000", "ltd ec"])
add("electric", "Gretsch", "G5420T Electromatic", dict(
    scale="other", scaleCustom="24.6", radius="12", fretSize="medium-jumbo", fbMaterial="laurel", nut="synthetic",
    neckJoint="set", trussAccess="headstock", bridgeType="bigsby", bridgeModel="Bigsby B60 + Adjusto-Matic",
    pickups="HH", pickupNotes="FT-5E Filter'Tron", gauge="10-46", bodyWood="Laminated maple, hollow body",
    neckFinish="gloss-poly"),
    verify=["trussAccess"], aliases=["g5420", "5420", "electromatic"])
add("electric", "Yamaha", "Pacifica 112V", dict(
    radius="13.8", fretSize="medium", fbMaterial="rosewood", nut="synthetic", trussAccess="headstock",
    bridgeType="trem-vintage", pickups="HSS", gauge="10-46", bodyWood="Alder", neckFinish="satin-poly"),
    verify=["radius", "gauge", "neckFinish"], aliases=["pacifica", "pac112", "112v"])

# ---------------- popular acoustics ----------------
add("acoustic", "Martin", "D-28", dict(
    scale="25.4", radius="16", fbMaterial="ebony", nut="bone", saddle="bone", trussAccess="soundhole", top="all-solid",
    gauge="12-54 (light)", bodyWood="Spruce top, East Indian rosewood back & sides", bodyFinish="nitro", neckFinish="nitro"),
    aliases=["d28", "d 28"])
add("acoustic", "Martin", "D-18", dict(
    scale="25.4", radius="16", fbMaterial="ebony", nut="bone", saddle="bone", trussAccess="soundhole", top="all-solid",
    gauge="12-54 (light)", bodyWood="Spruce top, mahogany back & sides", bodyFinish="nitro", neckFinish="nitro"),
    aliases=["d18", "d 18"])
add("acoustic", "Martin", "D-10E", dict(
    scale="25.4", radius="16", fbMaterial="other", nut="synthetic", saddle="synthetic", trussAccess="soundhole",
    top="solid", electronics="contact", battery="9v", gauge="12-54 (light)", bodyWood="Solid top, sapele laminate",
    bodyFinish="satin-poly", neckFinish="satin-poly"),
    verify=["fbMaterial", "electronics", "battery", "top"], aliases=["d10e", "road series"])
add("acoustic", "Taylor", "114ce", dict(
    scale="25.5", radius="15", fbMaterial="ebony", nut="synthetic", saddle="synthetic", neckJoint="bolt-on",
    trussAccess="headstock", top="solid", electronics="contact", battery="9v", gauge="12-53 (light)",
    bodyWood="Sitka spruce top, layered walnut", bodyFinish="satin-poly", neckFinish="satin-poly"),
    verify=["bodyFinish"], aliases=["114"])
add("acoustic", "Taylor", "214ce", dict(
    scale="25.5", radius="15", fbMaterial="ebony", nut="synthetic", saddle="synthetic", neckJoint="bolt-on",
    trussAccess="headstock", top="solid", electronics="contact", battery="9v", gauge="12-53 (light)",
    bodyWood="Sitka spruce top, layered rosewood", neckFinish="satin-poly"),
    aliases=["214"])
add("acoustic", "Taylor", "314ce", dict(
    scale="25.5", radius="15", fbMaterial="ebony", nut="synthetic", saddle="synthetic", neckJoint="bolt-on",
    trussAccess="headstock", top="all-solid", electronics="contact", battery="9v", gauge="12-53 (light)",
    bodyWood="Sitka spruce top, sapele back & sides", neckFinish="satin-poly"),
    aliases=["314"])
add("acoustic", "Taylor", "814ce", dict(
    scale="25.5", radius="15", fbMaterial="ebony", nut="synthetic", saddle="synthetic", neckJoint="bolt-on",
    trussAccess="headstock", top="all-solid", electronics="contact", battery="9v", gauge="12-53 (light)",
    bodyWood="Sitka spruce top, Indian rosewood back & sides", neckFinish="satin-poly"),
    aliases=["814"])
add("acoustic", "Taylor", "GS Mini", dict(
    scale="other", scaleCustom="23.5", radius="15", fbMaterial="ebony", nut="synthetic", saddle="synthetic",
    neckJoint="bolt-on", trussAccess="headstock", top="solid", gauge="12-53 (light)",
    bodyWood="Solid top, layered sapele", bodyFinish="satin-poly", neckFinish="satin-poly"),
    verify=["fbMaterial", "frets"], aliases=["gs mini", "gsmini"])
add("acoustic", "Yamaha", "FG800", dict(
    scale="25.6", fbMaterial="walnut", nut="synthetic", saddle="synthetic", trussAccess="soundhole", top="solid",
    gauge="12-53 (light)", bodyWood="Solid spruce top, nato/okoume back & sides", neckFinish="satin-poly"),
    verify=["saddle", "nut"], aliases=["fg800", "fg 800"])
add("acoustic", "Yamaha", "FG830", dict(
    scale="25.6", fbMaterial="rosewood", nut="synthetic", saddle="synthetic", trussAccess="soundhole", top="solid",
    gauge="12-53 (light)", bodyWood="Solid spruce top, rosewood laminate back & sides", neckFinish="satin-poly"),
    verify=["saddle", "nut"], aliases=["fg830"])
add("acoustic", "Yamaha", "LL16 ARE", dict(
    scale="25.6", fbMaterial="ebony", nut="bone", saddle="bone", trussAccess="soundhole", top="all-solid",
    electronics="blend", battery="aa", gauge="12-53 (light)", bodyWood="Engelmann spruce top, rosewood back & sides"),
    verify=["battery", "electronics"], aliases=["ll16"])
add("acoustic", "Gibson", "J-45 Standard", dict(
    scale="24.75", radius="12", fbMaterial="rosewood", nut="synthetic", saddle="synthetic", trussAccess="headstock",
    trussTool="5/16\" nut driver", top="all-solid", electronics="piezo", battery="9v", gauge="12-53 (light)",
    bodyWood="Sitka spruce top, mahogany back & sides", bodyFinish="nitro", neckFinish="nitro"),
    verify=["saddle", "battery"], aliases=["j45", "j-45"])
add("acoustic", "Gibson", "Hummingbird Standard", dict(
    scale="24.75", radius="12", fbMaterial="rosewood", nut="synthetic", saddle="synthetic", trussAccess="headstock",
    trussTool="5/16\" nut driver", top="all-solid", electronics="piezo", battery="9v", gauge="12-53 (light)",
    bodyWood="Sitka spruce top, mahogany back & sides", bodyFinish="nitro", neckFinish="nitro"),
    verify=["saddle", "battery"], aliases=["hummingbird"])
add("acoustic", "Fender", "CD-60S", dict(
    scale="other", scaleCustom="25.3", fbMaterial="walnut", nut="synthetic", saddle="synthetic", trussAccess="soundhole",
    top="solid", gauge="12-52", bodyWood="Solid spruce top, laminated mahogany"),
    verify=["radius", "trussAccess", "frets"], aliases=["cd60s", "cd-60"])
add("acoustic", "Seagull", "S6 Original", dict(
    scale="25.5", fbMaterial="rosewood", nut="synthetic", saddle="synthetic", trussAccess="soundhole", top="solid",
    gauge="12-53 (light)", bodyWood="Solid cedar top, wild cherry laminate", bodyFinish="satin-poly",
    neckFinish="satin-poly", frets=21),
    verify=["fbMaterial", "radius"], aliases=["s6"])
add("acoustic", "Yamaha", "C40 (classical)", dict(
    scale="25.6", radius="flat", frets=18, fbMaterial="rosewood", nut="plastic", saddle="plastic", trussAccess="none",
    stringType="nylon", top="laminate", bridgeAcoustic="tieblock", gauge="Normal tension (nylon)",
    bodyWood="Laminate spruce top", neckFinish="gloss-poly"),
    verify=["fbMaterial"], aliases=["c40", "classical"])
add("acoustic", "Cordoba", "C5", dict(
    scale="25.6", radius="flat", frets=19, fbMaterial="rosewood", nut="bone", saddle="bone", trussAccess="soundhole",
    stringType="nylon", top="solid", bridgeAcoustic="tieblock", gauge="Normal tension (nylon)",
    bodyWood="Solid cedar top, layered mahogany"),
    verify=["trussAccess", "fbMaterial"], aliases=["c5", "cordoba"])

# ---------------- popular basses ----------------
add("bass", "Fender", "Player Precision Bass", dict(
    radius="9.5", fretSize="medium-jumbo", fbMaterial="maple", nut="synthetic", trussAccess="headstock",
    bridgeType="bass-vintage", stringLoad="top", pickups="P", gauge="45-105", bodyWood="Alder", neckFinish="satin-poly"),
    verify=["trussAccess"], aliases=["p bass", "precision", "pbass", "player p"])
add("bass", "Fender", "Player Jazz Bass", dict(
    radius="9.5", fretSize="medium-jumbo", fbMaterial="maple", nut="synthetic", trussAccess="headstock",
    bridgeType="bass-vintage", stringLoad="top", pickups="JJ", gauge="45-105", bodyWood="Alder", neckFinish="satin-poly"),
    verify=["trussAccess"], aliases=["jazz bass", "j bass", "jbass", "player j"])
add("bass", "Fender", "American Professional II Precision Bass", dict(
    radius="9.5", fretSize="narrow-tall", fbMaterial="maple", nut="bone", trussAccess="headstock",
    bridgeType="bass-highmass", bridgeModel="Fender HiMass", stringLoad="both", pickups="P", gauge="45-105",
    bodyWood="Alder", neckFinish="satin-poly"),
    verify=["trussAccess"], aliases=["ampro p", "american professional precision"])
add("bass", "Fender", "American Professional II Jazz Bass", dict(
    radius="9.5", fretSize="narrow-tall", fbMaterial="maple", nut="bone", trussAccess="headstock",
    bridgeType="bass-highmass", bridgeModel="Fender HiMass", stringLoad="both", pickups="JJ", gauge="45-105",
    bodyWood="Alder", neckFinish="satin-poly"),
    verify=["trussAccess"], aliases=["ampro j", "american professional jazz"])
add("bass", "Squier", "Affinity Precision Bass PJ", dict(
    radius="9.5", fretSize="medium-jumbo", fbMaterial="laurel", nut="synthetic", bridgeType="bass-vintage",
    stringLoad="top", pickups="PJ", gauge="45-105", bodyWood="Poplar", neckFinish="satin-poly"),
    verify=["fbMaterial", "trussAccess", "bodyWood"], aliases=["affinity p", "squier p", "affinity pj"])
add("bass", "Ernie Ball Music Man", "StingRay Special", dict(
    radius="11", frets=22, fretSize="medium-jumbo", fretMaterial="stainless", fbMaterial="maple", nut="synthetic",
    trussAccess="spoke", bridgeType="bass-highmass", stringLoad="through", pickups="MM", active="yes", battery="9v",
    gauge="45-105", bodyWood="Roasted ash or alder", neckFinish="oil"),
    verify=["fbMaterial", "bodyWood"], aliases=["stingray", "sting ray", "music man"])
add("bass", "Ibanez", "SR300E", dict(
    frets=24, fretSize="medium", fbMaterial="jatoba", nut="plastic", trussAccess="headstock", bridgeType="bass-highmass",
    bridgeModel="Accu-cast B120", stringLoad="top", pickups="HH", pickupNotes="PowerSpan Dual Coil", active="yes",
    battery="9v", gauge="45-105", bodyWood="Nyatoh", neckFinish="satin-poly"),
    verify=["radius", "fbMaterial", "nut"], aliases=["sr300", "sr 300"])
add("bass", "Ibanez", "SR505E (5-string)", dict(
    strings=5, frets=24, fretSize="medium", fbMaterial="other", nut="synthetic", trussAccess="headstock",
    bridgeType="bass-monorail", bridgeModel="Ibanez Mono-rail V", stringLoad="top", pickups="HH",
    pickupNotes="Bartolini MK1", active="yes", battery="9v", gauge="45-130 (5-string)", tuning="BEADG standard (5-string)",
    bodyWood="Mahogany", neckFinish="oil"),
    verify=["fbMaterial", "bodyWood", "neckFinish"], aliases=["sr505", "sr505e"])
add("bass", "Yamaha", "TRBX304", dict(
    frets=24, fretSize="medium", fbMaterial="rosewood", nut="synthetic", trussAccess="headstock", bridgeType="bass-highmass",
    stringLoad="top", pickups="HH", active="yes", battery="9v", gauge="45-105", bodyWood="Mahogany"),
    verify=["fbMaterial", "pickups", "bridgeType"], aliases=["trbx", "trbx304"])
add("bass", "Gibson", "Thunderbird", dict(
    frets=20, fbMaterial="rosewood", nut="synthetic", neckJoint="through", trussAccess="headstock",
    trussTool="5/16\" nut driver", bridgeType="bass-tom", stringLoad="top", pickups="HH", gauge="45-105",
    bodyWood="Mahogany with maple/mahogany neck-through", bodyFinish="nitro", neckFinish="nitro"),
    verify=["radius", "stringLoad"], aliases=["thunderbird", "t-bird", "tbird"])

if __name__ == "__main__":
    ids = [m["id"] for m in MODELS]
    assert len(ids) == len(set(ids)), "duplicate ids"
    OUT.write_text(json.dumps({"models": MODELS}, indent=1))
    print(f"wrote {len(MODELS)} models to {OUT}")
