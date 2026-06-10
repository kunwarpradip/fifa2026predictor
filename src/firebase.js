import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const configuredAuthDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;

function getAuthDomain() {
  if (typeof window === "undefined" || !projectId) {
    return configuredAuthDomain;
  }

  const currentHost = window.location.hostname;
  const firebaseHostingDomains = new Set([
    `${projectId}.firebaseapp.com`,
    `${projectId}.web.app`,
  ]);

  return firebaseHostingDomains.has(currentHost)
    ? currentHost
    : configuredAuthDomain;
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: getAuthDomain(),
  projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({ prompt: "select_account" });
export const authPersistenceReady = setPersistence(auth, browserLocalPersistence)
  .catch(() => setPersistence(auth, browserSessionPersistence))
  .catch(() => setPersistence(auth, inMemoryPersistence));
