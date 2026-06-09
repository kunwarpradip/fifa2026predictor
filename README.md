# FIFA World Cup 2026 Predictor

Mobile-first prediction portal with Google/Gmail login, user profiles, match predictions, admin match/result management, scoring, and leaderboard.

## Stack
- React + Vite
- Firebase Authentication with Google provider
- Cloud Firestore
- Optional Firebase Hosting

## Setup
1. Create a Firebase project.
2. Enable **Authentication > Sign-in method > Google**.
3. Create a Firestore database.
4. Copy `.env.example` to `.env` and fill in the Firebase web app config.
5. Deploy or paste `firebase.rules` into **Firestore Rules**.
6. Add your first admin manually in Firestore:
   - Collection: `admins`
   - Document ID: your Firebase Auth UID
   - Fields: `email`, `role: "admin"`

## Run locally
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
npm run preview
```

## Deploy to Firebase Hosting
```bash
npm install -g firebase-tools
firebase login
firebase init hosting
npm run build
firebase deploy
```
Set Hosting public directory to `dist` and choose single-page app rewrite.

## Scoring
- Exact score: 4 points
- Correct win/loss/draw outcome only: 2 points
- Wrong outcome: 0 points

Predictions lock after kickoff time. Admins publish results; leaderboard totals update automatically.
