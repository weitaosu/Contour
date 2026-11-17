import "dotenv/config";
import { GeminiPublicClient } from "@contour/gemini";
import { openDb } from "./db";
import { startRecorder } from "./recorder";

const db = openDb(process.env.RECORDER_DB_PATH ?? process.env.DB_PATH);
startRecorder(db, new GeminiPublicClient(process.env.GEMINI_API_BASE));
console.log("[recorder] running every 5 minutes");
