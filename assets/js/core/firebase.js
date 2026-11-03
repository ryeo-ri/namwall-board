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

// config 미기입 가드: 값이 비어 있으면 초기화하지 않고 설정 안내(setup.html)로 보낸다.
export const configMissing = !(firebaseConfig.apiKey && firebaseConfig.projectId);

let app = null;
let auth = null;
let db = null;
let storage = null;

if (!configMissing) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
} else if (!location.pathname.endsWith("/setup.html")) {
  location.replace("setup.html"); // <base> 기준 상대 해석 (서브경로 지원)
}

export { app, auth, db, storage };
