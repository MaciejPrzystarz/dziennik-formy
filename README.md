# Dziennik formy

Codzienne wpisy: waga, kalorie, trening, samopoczucie. Statyczna aplikacja webowa (HTML, CSS, JS, bez backendu).
Dane leżą w `data/health.json` w tym repozytorium. Wpis można dodać w aplikacji albo napisać Claude'owi w czacie:
obie drogi zmieniają ten sam plik.

## Struktura

```
web/                          aplikacja (tylko to publikuje GitHub Pages)
  index.html
  css/  js/  fonts/  icons/
  vendor/chart.umd.min.js     Chart.js 4.5.1
  config.js                   owner/repo, gdy aplikacja nie stoi na GitHub Pages
data/health.json              dane, jedyne źródło prawdy
CLAUDE.md                     zasady edycji danych dla Claude'a
.github/workflows/pages.yml   deploy web/ na GitHub Pages
```

## Uruchomienie lokalne (IntelliJ)

1. File → Open → folder projektu.
2. Prawy klik na `web/index.html` → Open In → Browser. Wbudowany serwer IntelliJ poda stronę,
   a aplikacja przeczyta `data/health.json` z dysku (tylko podgląd).
   Alternatywa: w terminalu w katalogu projektu `jwebserver` (JDK 18+), potem http://localhost:8000/web/.
3. Przycisk „Pokaż przykładowe dane” pokazuje wszystkie funkcje na wymyślonych danych.

Nie otwieraj pliku bezpośrednio (`file://`): przeglądarka zablokuje odczyt danych.

## Publikacja

1. IntelliJ: Git → GitHub → Share Project on GitHub (np. nazwa `dziennik-formy`).
2. GitHub: Settings → Pages → Build and deployment → Source: **GitHub Actions**.
   Potem Actions → Pages → Run workflow (kolejne wdrożenia idą same po zmianach w `web/`).
3. Aplikacja działa pod `https://<login>.github.io/dziennik-formy/` i sama rozpoznaje repozytorium.

Prywatność: w publicznym repo waga i notatki są publiczne. GitHub Pages z prywatnego repo wymaga GitHub Pro
(darmowy w GitHub Student Developer Pack). Druga opcja: prywatne repo + Netlify (publish directory `web`,
w `web/config.js` wpisz `owner` i `repo`). Strona zawiera tylko aplikację; dane są pobierane przez API z tokenem.

## Token (zapis z aplikacji)

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.
2. Repository access: Only select repositories → to repozytorium.
3. Repository permissions → Contents: **Read and write**.
4. Expiration: np. 90 dni.
5. W aplikacji: ikona ustawień → Token GitHuba → Połącz.

Token zostaje w localStorage tej przeglądarki (na każdym urządzeniu wklejasz go raz). Nie wpisuj go do `config.js`
ani do repozytorium. Bez tokenu aplikacja działa w trybie podglądu.

## Wpisy przez Claude'a

Napisz np. „dziś 84,2, 2450 kcal, Upper A, samopoczucie 4”. Claude zmienia `data/health.json` według `CLAUDE.md`:

- **Claude Code** (np. w IntelliJ): edytuje plik, robi commit i push.
- **claude.ai**: potrzebuje dostępu do repo przez GitHub API. Użyj osobnego tokenu jak wyżej, z krótkim terminem
  ważności, i usuń go po sesji.

Aplikacja przy każdym zapisie pobiera świeży plik i łączy zmiany pole po polu, więc wpis z czatu i wpis z telefonu
z tego samego dnia się nie nadpisują. Po powrocie do karty dane odświeżają się same.

## Format danych

```json
{
  "settings": {"name": "Maciej", "startDate": "2026-09-28", "startWeight": 85, "targetWeight": 78,
               "targetDate": "2027-03-31", "kcalTarget": 2459, "weeklyTrainings": 4,
               "trainings": ["Upper A", "Lower", "Upper B", "Rower"]},
  "entries": [
    {"date": "2026-09-28", "weight": 84.2, "kcal": 2450, "training": "Upper A", "mood": 4, "note": "..."}
  ]
}
```

Jeden wpis na dzień. Wszystkie pola poza `date` są opcjonalne. `mood`: 1 źle, 2 słabo, 3 OK, 4 dobrze, 5 petarda.

## Jak liczone są wskaźniki

- Sztanga: każdy kilogram celu to talerz (maks. 10 talerzy, przy większym celu talerz waży więcej).
  Liczy się średnia z 7 dni, więc jednodniowe wahania nie zdejmują talerzy.
- Tempo: nachylenie wagi z ostatnich 3 tygodni. Prognoza: data osiągnięcia celu przy tym tempie.
- Kalorie „w celu”: od 85% do 105% `kcalTarget`; powyżej 105% dzień jest „ponad cel”.
- Skrót klawiszowy `n`: nowy wpis.
