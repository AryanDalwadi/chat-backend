import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const serviceAccountPath = fileURLToPath(
  new URL("../../firebase-service-account.json", import.meta.url),
);
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf8")) as ServiceAccount;

if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}

export const firestore = getFirestore();
export { FieldValue };

export function getFirebaseAuth(): Auth {
  return getAuth();
}
