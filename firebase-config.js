// REPLACE the values below with your Firebase config.
// Firebase console → Project Settings → Your apps → Web app → Config
const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME"
};

// Detect if Firebase is configured yet
window.FIREBASE_READY = firebaseConfig.apiKey !== "REPLACE_ME";

if (window.FIREBASE_READY) {
  firebase.initializeApp(firebaseConfig);
  window.ODC_DB   = firebase.firestore();
  window.ODC_AUTH = firebase.auth();
} else {
  // Fallback: use local Node.js server auth (localhost:5050)
  window.ODC_DB   = null;
  window.ODC_AUTH = null;
}
