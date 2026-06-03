// REPLACE THIS with your Firebase config from console.firebase.google.com
// Project Settings → Your apps → Web app → Config
const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME"
};

firebase.initializeApp(firebaseConfig);
window.ODC_DB   = firebase.firestore();
window.ODC_AUTH = firebase.auth();
