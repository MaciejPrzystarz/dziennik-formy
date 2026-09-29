# Dziennik formy: zasady dla Claude'a

Dane: `data/health.json`. To jedyne źródło prawdy dla aplikacji w `web/`. Aplikacja zapisuje ten sam plik
przez GitHub API, więc przed każdą zmianą pobierz jego aktualną wersję.

## Gdy użytkownik podaje dane dnia

Przykłady: „dziś 84,2, 2450 kcal, Upper A, 4/5”, „wczoraj rower 40 km, samopoczucie petarda”, „spałem 7,5 h, sen 82”.

1. Ustal datę (dziś, wczoraj, konkretny dzień; strefa Europe/Warsaw). Jeśli nie wynika z wiadomości, zapytaj.
2. Znajdź wpis z tą datą. Jest: zmień tylko pola podane teraz, resztę zostaw. Nie ma: dodaj nowy wpis.
3. Zapisz plik, zrób commit i push (albo PUT przez API, niżej).
4. Odpowiedz jedną linią: co zapisano. Na prośbę policz średnią z 7 dni lub zmianę z pliku.

## Format

- `entries` posortowane rosnąco po `date`, jeden wpis na dzień, każdy wpis w jednej linii:
  `    {"date": "2026-09-28", "weight": 84.2, "kcal": 2450, "training": "Upper A", "mood": 4, "sleep": 7.5, "sleepScore": 82, "note": "..."}`
- Kolejność kluczy: `date`, `weight`, `kcal`, `training`, `mood`, `sleep`, `sleepScore`, `note`. Brak wartości = brak klucza
  (bez `null` i pustych napisów).
- `date`: `RRRR-MM-DD`.
- `weight`: kg, liczba z kropką, maks. 2 miejsca po przecinku („84,2” → `84.2`).
- `kcal`: liczba całkowita.
- `training`: dokładnie nazwa z `settings.trainings`. Mapuj opisowe nazwy („góra A” → `"Upper A"`, „nogi” → `"Lower"`,
  „rower” → `"Rower"`). Gdy nic nie pasuje, zapytaj. Dzień bez treningu: pomiń pole.
- `mood`: 1 źle, 2 słabo, 3 OK, 4 dobrze, 5 petarda. Słowa i oceny typu „4/5” zamieniaj na liczbę.
- `sleep`: jakość snu, czyli ile godzin: liczba z kropką, 0–24, maks. 2 miejsca po przecinku („7,5 h” → `7.5`, „7 h 20 min” → `7.33`).
- `sleepScore`: ocena snu 0–100, liczba całkowita („sen 82/100”, „ocena snu 82” → `82`).
- `note`: krótko, maks. 280 znaków (np. rekord, dystans roweru).
- `settings` (cele) zmieniaj tylko na wyraźną prośbę. Nie usuwaj pól, których nie znasz.
- Plik musi zostać poprawnym JSON-em. Przy błędzie składni aplikacja przechodzi w tryb tylko do odczytu.

## Commit

- Wpis: `log: 2026-09-28 (84.2 kg, 2450 kcal, Upper A, 4/5, 7.5 h snu, sen 82/100)`: pola, które ma wpis, w tej kolejności.
- Usunięcie: `log: usuń 2026-09-28`
- Cele: `settings: cel 78 kg do 2027-03-31, 2450 kcal, 4 treningi/tydz.`
- Gałąź `main`. Zmieniaj tylko `data/health.json`, chyba że użytkownik prosi o zmiany w aplikacji.

## Zapis przez GitHub API (bez lokalnego repo)

Wymaga tokenu fine-grained z uprawnieniem Contents: Read and write do tego repozytorium.

```bash
OWNER=<login> REPO=dziennik-formy TOKEN=<token>
API="https://api.github.com/repos/$OWNER/$REPO/contents/data/health.json"
H=(-H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json")

# 1. aktualny plik i sha, zawsze tuż przed zapisem
curl -s "${H[@]}" "$API?ref=main" > resp.json
SHA=$(jq -r .sha resp.json)
jq -r .content resp.json | base64 -d > health.json

# 2. edycja health.json według zasad wyżej

# 3. zapis
jq -n --arg message "log: 2026-09-28 (84.2 kg, 2450 kcal)" --arg sha "$SHA" \
      --arg content "$(base64 -w0 health.json)" \
      '{message: $message, content: $content, sha: $sha, branch: "main"}' |
  curl -s -X PUT "${H[@]}" "$API" -d @- | jq -r '.commit.html_url // .message'
```

409 lub 422 z informacją o `sha` oznacza, że plik zmienił się w międzyczasie: powtórz od kroku 1.
