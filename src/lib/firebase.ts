import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Test connection
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();

export const loginAnonymously = async () => {
  // Anonymous login is restricted in some environments.
  // We will use a unique ID stored in localStorage instead.
  let localId = localStorage.getItem('meme_battle_user_id');
  if (!localId) {
    localId = Math.random().toString(36).substring(2, 15);
    localStorage.setItem('meme_battle_user_id', localId);
  }
  return { uid: localId };
};
