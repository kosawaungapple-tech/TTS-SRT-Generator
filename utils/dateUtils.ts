/**
 * Formats a timestamp into a readable string.
 * Handles Firestore Timestamp objects, ISO strings, and Unix numbers.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function formatDate(timestamp: any): string {
  if (!timestamp) return "—";
  
  let date: Date;
  
  // Handle Firestore Timestamp object
  if (timestamp?.toDate) {
    date = timestamp.toDate();
  }
  // Handle Firestore Timestamp with seconds field
  else if (timestamp?.seconds) {
    date = new Date(timestamp.seconds * 1000);
  }
  // Handle ISO string or Unix ms number
  else {
    date = new Date(timestamp);
  }
  
  if (isNaN(date.getTime())) return "—";
  
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
