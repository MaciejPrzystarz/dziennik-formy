# Dziennik formy: zasady dla Claude'a

Dane: `data/health.json` na gałęzi `bufor`. To aktualna wersja dla aplikacji w `web/`: aplikacja czyta i zapisuje ten
plik przez GitHub API, więc przed każdą zmianą pobierz jego aktualną wersję. `main` dostaje dane tylko raz w tygodniu
(niżej, „Cotygodniowy commit”), więc między niedzielami jest w tyle. Gdy gałęzi `bufor` jeszcze nie ma, czytaj z `main`,
a przed zapisem utwórz `bufor` z `main` (krok 0 niżej).

## Gdy użytkownik podaje dane dnia

Przykłady: „dziś 84,2, 2450 kcal, Upper A, 4/5”, „wczoraj rower 40 km, samopoczucie petarda”, „spałem 7,5 h, sen 82”,
„makro 160/70/290”, „białko 165, tłuszcze 60, węgle 300”.

1. Ustal datę (dziś, wczoraj, konkretny dzień; strefa Europe/Warsaw). Jeśli nie wynika z wiadomości, zapytaj.
2. Znajdź wpis z tą datą. Jest: zmień tylko pola podane teraz, resztę zostaw. Nie ma: dodaj nowy wpis.
3. Zapisz plik na gałęzi `bufor`: commit i push na `bufor` (albo PUT przez API, niżej). Nigdy bezpośrednio na `main`.
4. Odpowiedz jedną linią: co zapisano. Na prośbę policz średnią z 7 dni lub zmianę z pliku.

## Format

- `entries` posortowane rosnąco po `date`, jeden wpis na dzień, każdy wpis w jednej linii:
  `    {"date": "2026-09-28", "weight": 84.2, "kcal": 2450, "protein": 160, "fat": 70, "carbs": 290, "training": "Upper A", "mood": 4, "sleep": 7.5, "sleepScore": 82, "note": "..."}`
- Kolejność kluczy: `date`, `weight`, `kcal`, `protein`, `fat`, `carbs`, `training`, `mood`, `sleep`, `sleepScore`, `note`.
  Brak wartości = brak klucza (bez `null` i pustych napisów).
- `date`: `RRRR-MM-DD`.
- `weight`: kg, liczba z kropką, maks. 2 miejsca po przecinku („84,2” → `84.2`).
- `kcal`: liczba całkowita.
- `protein`, `fat`, `carbs`: białko, tłuszcze, węglowodany w gramach, liczby całkowite 0–1000. Trzy liczby bez nazw
  („makro 160/70/290”, „B/T/W 160 70 290”) to zawsze kolejność białko, tłuszcze, węgle. Gdy podano wszystkie trzy,
  a kalorii nie, wpisz `kcal` = 4 × białko + 9 × tłuszcze + 4 × węgle (tak liczy aplikacja). Podane kalorie zostaw, nawet
  jeśli różnią się od wyliczonych.
- `training`: dokładnie nazwa z `settings.trainings`. Mapuj opisowe nazwy („góra A” → `"Upper A"`, „nogi” → `"Lower"`,
  „rower” → `"Rower"`). Gdy nic nie pasuje, zapytaj. Dzień bez treningu: pomiń pole.
- `mood`: 1 źle, 2 słabo, 3 OK, 4 dobrze, 5 petarda. Słowa i oceny typu „4/5” zamieniaj na liczbę.
- `sleep`: jakość snu, czyli ile godzin: liczba z kropką, 0–24, maks. 2 miejsca po przecinku („7,5 h” → `7.5`, „7 h 20 min” → `7.33`).
- `sleepScore`: ocena snu 0–100, liczba całkowita („sen 82/100”, „ocena snu 82” → `82`).
- `note`: krótko, maks. 280 znaków (np. rekord, dystans roweru).
- `settings` (cele) zmieniaj tylko na wyraźną prośbę. Nie usuwaj pól, których nie znasz. Cele makro są opcjonalne:
  `proteinTarget`, `fatTarget`, `carbsTarget` (gramy dziennie, liczby całkowite), zaraz po `kcalTarget`. Brak celu = brak klucza.
- Plik musi zostać poprawnym JSON-em. Przy błędzie składni aplikacja przechodzi w tryb tylko do odczytu.

## Commit

- Wpis: `log: 2026-09-28 (84.2 kg, 2450 kcal, B 160 g, T 70 g, W 290 g, Upper A, 4/5, 7.5 h snu, sen 82/100)`: pola, które ma
  wpis, w tej kolejności.
- Usunięcie: `log: usuń 2026-09-28`
- Cele: `settings: cel 78 kg do 2027-03-31, 2450 kcal, B 160 g, T 70 g, W 290 g, 4 treningi/tydz.` (cele makro tylko te, które są).
- Dane: gałąź `bufor`. Zmieniaj tylko `data/health.json`, chyba że użytkownik prosi o zmiany w aplikacji. Zmiany aplikacji
  (`web/`, `tests/`, `scripts/`, `.github/`) idą na `main` jak dotąd.
- Przy zmianach w `web/js/` uruchom testy: `tests/index.html` w przeglądarce albo `node tests/run.mjs`.

## Cotygodniowy commit

W niedzielę o 10:00 (Europe/Warsaw) `.github/workflows/weekly.yml` przenosi zakończony tydzień z `bufor` na `main` jednym
commitem: tydzień to niedziela–sobota przed tą niedzielą (11.10.2026 → 2026-10-04 do 2026-10-10). Razem z nim idą
poprawki starszych dni i zmiany celów. Dni od niedzieli włącznie zostają na `bufor` do kolejnego tygodnia. Potem `bufor`
jest przebudowywany na nowym `main` (stare commity zapisów znikają). Commit: `log: tydzień 2026-10-04 – 2026-10-10 (7 dni
z wpisem, poprawki: 2026-10-01, cele)`. Logika: `weekWindow` i `weeklyMerge` w `web/js/store.js`, skrypt
`scripts/weekly-commit.mjs`. Ręcznie: Actions → Weekly commit → Run workflow (powtórne uruchomienie nic nie psuje).

## Cotygodniowe podsumowanie

W niedzielę o 10:00 (Europe/Warsaw) zaplanowane zadanie czyta `data/health.json` z gałęzi `bufor` i wysyła jeden mail
z podsumowaniem tego samego tygodnia co commit (niedziela–sobota), bez ponowień. Oprócz liczb (waga, kalorie i makro
wobec celów, treningi wobec `weeklyTrainings`, sen, samopoczucie) wyciąga wnioski: czyta notatki (`note`) z każdego dnia,
łączy je z danymi, szuka zależności (sen, treningi, kalorie, waga dzień po dniu), porównuje z poprzednimi tygodniami
i daje 1–2 konkretne działania na kolejny tydzień. Dlatego warto w `note` pisać, jak poszedł dzień. Tylko czyta dane:
nic nie zapisuje w repo.

## Zapis przez GitHub API (bez lokalnego repo)

Wymaga tokenu fine-grained z uprawnieniem Contents: Read and write do tego repozytorium.

```bash
OWNER=<login> REPO=dziennik-formy TOKEN=<token>
REPO_API="https://api.github.com/repos/$OWNER/$REPO"
API="$REPO_API/contents/data/health.json"
H=(-H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json")

# 0. gałąź bufor, jeśli jej nie ma (422 „Reference already exists” = już jest, w porządku)
if [ "$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" "$REPO_API/git/ref/heads/bufor")" = 404 ]; then
  MAIN=$(curl -s "${H[@]}" "$REPO_API/git/ref/heads/main" | jq -r .object.sha)
  curl -s -X POST "${H[@]}" "$REPO_API/git/refs" -d "{\"ref\": \"refs/heads/bufor\", \"sha\": \"$MAIN\"}" > /dev/null
fi

# 1. aktualny plik i sha, zawsze tuż przed zapisem
curl -s "${H[@]}" "$API?ref=bufor" > resp.json
SHA=$(jq -r .sha resp.json)
jq -r .content resp.json | base64 -d > health.json

# 2. edycja health.json według zasad wyżej

# 3. zapis
jq -n --arg message "log: 2026-09-28 (84.2 kg, 2450 kcal)" --arg sha "$SHA" \
      --arg content "$(base64 -w0 health.json)" \
      '{message: $message, content: $content, sha: $sha, branch: "bufor"}' |
  curl -s -X PUT "${H[@]}" "$API" -d @- | jq -r '.commit.html_url // .message'
```

409 lub 422 z informacją o `sha` oznacza, że plik zmienił się w międzyczasie (np. niedzielna przebudowa `bufor`):
powtórz od kroku 1.
