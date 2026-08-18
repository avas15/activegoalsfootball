# Active Goals CRM Firestore rules

Add these matches inside the existing `match /databases/{database}/documents` block in
Firebase Console. Keep the existing public `content` and `schedule` reads and authenticated
`messages` access unchanged.

```text
match /players/{doc} { allow read, write: if request.auth != null; }
match /venues/{doc} { allow read, write: if request.auth != null; }
match /sessions/{doc} { allow read, write: if request.auth != null; }
match /attendance/{doc} { allow read, write: if request.auth != null; }
match /payments/{doc} { allow read, write: if request.auth != null; }
match /warnings/{doc} { allow read, write: if request.auth != null; }
match /awards/{doc} { allow read, write: if request.auth != null; }
```

Verify with the Rules simulator: unauthenticated reads of `players`, `attendance`, and
`payments` must be denied; the existing public `content` and `schedule` reads must remain allowed.
