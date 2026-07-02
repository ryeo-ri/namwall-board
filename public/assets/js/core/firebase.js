// /assets/js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDTfCvbLzo4P8Qf5ZU54tsfXB_GCy14vro",
  authDomain: "namwall-board.firebaseapp.com",
  projectId: "namwall-board",
  storageBucket: "namwall-board.firebasestorage.app",
  messagingSenderId: "258594191114",
  appId: "1:258594191114:web:617fd13eae56a81756acf3",
  measurementId: "G-4BJLMW6596"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
