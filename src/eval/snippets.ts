// src/eval/snippets.ts

/**
 * This file contains common code snippets that can be used in the eval component.
 * These snippets are designed to be easily inserted using code completion.
 */

// Example snippet: Function to check if a value is a number
export const isNumberSnippet = `
/**
 * Checks if a value is a number.
 * @param value The value to check.
 * @returns True if the value is a number, false otherwise.
 */
function isNumber(value: any): boolean {
  return typeof value === 'number' && !isNaN(value);
}
`;

// Example snippet: Function to check if a value is a string
export const isStringSnippet = `
/**
 * Checks if a value is a string.
 * @param value The value to check.
 * @returns True if the value is a string, false otherwise.
 */
function isString(value: any): boolean {
  return typeof value === 'string';
}
`;

// Example snippet: Function to check if a value is an array
export const isArraySnippet = `
/**
 * Checks if a value is an array.
 * @param value The value to check.
 * @returns True if the value is an array, false otherwise.
 */
function isArray(value: any): boolean {
  return Array.isArray(value);
}
`;

// Example snippet: Function to safely parse JSON
export const safeJsonParseSnippet = `
/**
 * Safely parses a JSON string.
 * @param jsonString The JSON string to parse.
 * @returns The parsed JSON object, or null if parsing fails.
 */
function safeJsonParse<T>(jsonString: string): T | null {
  try {
    return JSON.parse(jsonString) as T;
  } catch (error) {
    console.error('Error parsing JSON:', error);
    return null;
  }
}
`;

// Example snippet: Function to log a message with a timestamp
export const logWithTimestampSnippet = `
/**
 * Logs a message with a timestamp.
 * @param message The message to log.
 */
function logWithTimestamp(message: string): void {
  const timestamp = new Date().toISOString();
  console.log(\`[\${timestamp}] \${message}\`);
}
`;