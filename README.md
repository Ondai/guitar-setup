# Setup Bench

Tailored setup guides for electric guitar, acoustic guitar and electric bass. Runs on your computer, and you use it from the iPad over Wi-Fi.

## First-time setup

You need Python 3.10 or newer (macOS: `brew install python`, Windows: python.org).

```bash
pip install -r requirements.txt
```

### Turn on spec lookup (optional but recommended)

Spec lookup searches the web for your model's factory specs using the Claude API. Create an API key at console.anthropic.com (Settings → API keys), then set it in the terminal you start the server from:

macOS / Linux:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Windows (PowerShell):
```powershell
$env:ANTHROPIC_API_KEY="sk-ant-..."
```

Each new lookup runs a few web searches plus two Claude requests, so it costs a little API credit. Results are cached, so looking up the same model again is free. Without a key everything else works; you just enter specs by hand.

## Run it

```bash
python3 server.py
```

It prints two addresses. Open the **iPad** one (e.g. `http://192.168.1.23:8000`) in Safari, on the same Wi-Fi. On Windows, allow Python through the firewall the first time it asks. In Safari, tap Share → **Add to Home Screen** for a full-screen app icon.

## Using it

1. **Create an account** (stored on your computer, in `setupbench.db`).
2. **Fill in My toolbox:** tick every tool you own. Add brand-specific ones under "Other tools you own".
3. Pick **Electric Guitar**, **Acoustic Guitar** or **Electric Bass**, type the make and model, and tap **Look up specs**. It takes 30–90 seconds.
4. **Check the specs.** Fields the lookup estimated, or that vary between versions, are marked **Check**, and the sources it used are listed. Fix anything that's wrong.
5. **Generate setup guide.** If you're missing any tools the guide requires, a warning appears at the top and in Tools & supplies.
6. Check off steps as you go, and record what you set in the **Setup log**.

## Notes

- **Your data** (accounts, instruments, logs, toolbox, cached lookups) lives in `setupbench.db` next to `server.py`. Copy that file to back it up.
- **Security:** this is meant for your home network. It uses plain HTTP, so don't expose the port to the internet.
- If you used the earlier version, instruments it saved on the iPad are moved into your account the first time you sign in there.

## Files

- `server.py`: web server and JSON API (accounts, toolbox, instruments, lookup cache)
- `lookup.py`: the spec lookup (Claude with web search, then structured extraction)
- `data/options.json`: every spec option, shared by the form and the lookup
- `js/guide.js`: the guide generator (setup logic and target numbers)
- `js/tools.js`: tool catalog and per-guitar tool requirements
- `js/app.js`: screens, form, toolbox, setup log
- `js/data.js`: bridge-model notes and factory-target overrides
