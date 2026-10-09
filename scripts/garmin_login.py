"""One-time Garmin login on your own computer. Prints nothing secret.

Asks for the Garmin e-mail, password and MFA code (if enabled), logs in with the garminconnect library
and copies the token (JSON) to the clipboard. Paste it into the repo secret GARMIN_TOKENS:
GitHub -> Settings -> Secrets and variables -> Actions. The password is not saved anywhere.

Run it again when the Garmin workflow says the login stopped working (e.g. 30 days without any run).

Usage: pip install garminconnect==0.3.17 && python scripts/garmin_login.py
"""
import getpass
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from garminconnect import Garmin


def copy_to_clipboard(text):
    commands = [["clip"], ["pbcopy"], ["wl-copy"], ["xclip", "-selection", "clipboard"]]
    for cmd in commands:
        if shutil.which(cmd[0]):
            subprocess.run(cmd, input=text.encode("utf-8"), check=True)
            return True
    return False


def main():
    email = input("E-mail do Garmin Connect: ").strip()
    password = getpass.getpass("Hasło (nie widać go przy wpisywaniu): ")
    folder = tempfile.mkdtemp(prefix="garmin-")
    try:
        api = Garmin(email, password, prompt_mfa=lambda: input("Kod MFA z maila lub aplikacji: ").strip())
        api.login(folder)
        tokens = (Path(folder) / "garmin_tokens.json").read_text(encoding="utf-8")
        name = api.get_full_name() or email
    finally:
        shutil.rmtree(folder, ignore_errors=True)

    print(f"Zalogowano jako: {name}")
    if copy_to_clipboard(tokens):
        print("Token jest w schowku. Wklej go jako sekret GARMIN_TOKENS w repo dziennik-formy:")
        print("GitHub -> Settings -> Secrets and variables -> Actions -> New repository secret.")
        print("Potem skopiuj coś innego, żeby token nie został w schowku.")
    else:
        path = Path.home() / "garmin_tokens.json"
        path.write_text(tokens, encoding="utf-8")
        print(f"Nie mam dostępu do schowka. Token zapisany w {path}: wklej jego treść jako sekret "
              "GARMIN_TOKENS, potem usuń plik.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
