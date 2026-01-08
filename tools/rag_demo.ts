#!/usr/bin/env npx tsx
/**
 * RAG Demo
 * ========
 *
 * Demonstrates vector-based retrieval-augmented generation.
 */

import { createRAGRetriever, type Document } from '../src/rag/index.js';

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                        RAG DEMO                                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  // Create RAG retriever with Gemini embeddings
  const rag = createRAGRetriever({
    embedding_provider: 'gemini',
    store_type: 'memory',
    chunking: {
      strategy: 'code',
      max_chunk_size: 1000,
      overlap: 100,
    },
  });

  console.log(`RAG Retriever ID: ${rag.id}\n`);

  // Sample documents to index
  const documents: Document[] = [
    {
      id: 'auth_module',
      type: 'code',
      language: 'typescript',
      source: 'src/auth/authenticate.ts',
      content: `
/**
 * Authentication module for user login and session management.
 */

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user' | 'guest';
}

export interface AuthResult {
  success: boolean;
  user?: User;
  token?: string;
  error?: string;
}

/**
 * Authenticate a user with email and password.
 */
export async function authenticate(
  email: string,
  password: string
): Promise<AuthResult> {
  // Validate inputs
  if (!email || !password) {
    return { success: false, error: 'Email and password required' };
  }

  // Check against database
  const user = await findUserByEmail(email);
  if (!user) {
    return { success: false, error: 'User not found' };
  }

  // Verify password
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return { success: false, error: 'Invalid password' };
  }

  // Generate session token
  const token = generateToken(user.id);

  return {
    success: true,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    token,
  };
}

/**
 * Verify a session token and return the user.
 */
export async function verifySession(token: string): Promise<User | null> {
  try {
    const payload = decodeToken(token);
    const user = await findUserById(payload.userId);
    return user;
  } catch {
    return null;
  }
}
`,
    },
    {
      id: 'validation_utils',
      type: 'code',
      language: 'typescript',
      source: 'src/utils/validation.ts',
      content: `
/**
 * Validation utilities for input sanitization.
 */

/**
 * Validate email format.
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate password strength.
 * Requires at least 8 characters, one uppercase, one lowercase, one number.
 */
export function isStrongPassword(password: string): boolean {
  if (password.length < 8) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  return true;
}

/**
 * Sanitize string input to prevent XSS.
 */
export function sanitizeInput(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Validate UUID format.
 */
export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}
`,
    },
    {
      id: 'api_routes',
      type: 'code',
      language: 'typescript',
      source: 'src/api/routes.ts',
      content: `
/**
 * API route handlers for the REST API.
 */

import { authenticate, verifySession } from '../auth/authenticate.js';
import { isValidEmail } from '../utils/validation.js';

/**
 * POST /api/login
 * Authenticate user and return session token.
 */
export async function handleLogin(req: Request): Promise<Response> {
  const body = await req.json();
  const { email, password } = body;

  if (!isValidEmail(email)) {
    return new Response(JSON.stringify({ error: 'Invalid email format' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = await authenticate(email, password);

  if (!result.success) {
    return new Response(JSON.stringify({ error: result.error }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ user: result.user, token: result.token }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * GET /api/me
 * Get current user from session.
 */
export async function handleGetCurrentUser(req: Request): Promise<Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = authHeader.slice(7);
  const user = await verifySession(token);

  if (!user) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ user }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
`,
    },
    {
      id: 'auth_docs',
      type: 'doc',
      source: 'docs/authentication.md',
      content: `
# Authentication Guide

## Overview

The authentication system uses JWT tokens for session management.

## Login Flow

1. User submits email and password to POST /api/login
2. Server validates credentials against the database
3. If valid, server returns a JWT token
4. Client stores token and includes it in subsequent requests

## Token Format

Tokens are JWTs with the following payload:
- userId: The user's unique identifier
- role: User's role (admin, user, guest)
- exp: Expiration timestamp

## Security Considerations

- Passwords are hashed using bcrypt with salt rounds of 12
- Tokens expire after 24 hours
- Refresh tokens can be used to obtain new access tokens
- All authentication endpoints are rate-limited

## Error Codes

- 400: Invalid input (malformed email, missing fields)
- 401: Authentication failed (wrong password, invalid token)
- 403: Authorization failed (insufficient permissions)
- 429: Rate limit exceeded
`,
    },
  ];

  // Index documents
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('                      INDEXING DOCUMENTS                            ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  for (const doc of documents) {
    const chunks = await rag.index(doc);
    console.log(`Indexed: ${doc.source || doc.id} (${chunks} chunks)`);
  }

  const stats = rag.getStats();
  console.log(`\nTotal: ${stats.total_documents} documents, ${stats.total_chunks} chunks`);
  console.log(`Embedding tokens used: ${stats.total_embedding_tokens}`);

  // Test searches
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                        SEARCH TESTS                                ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const queries = [
    'How do I authenticate a user with email and password?',
    'How to validate email format?',
    'What is the login API endpoint?',
    'How are passwords stored securely?',
  ];

  for (const query of queries) {
    console.log(`Query: "${query}"`);
    console.log('─'.repeat(60));

    const results = await rag.getContext(query, {
      limit: 3,
      min_similarity: 0.3,
    });

    if (results.length === 0) {
      console.log('No results found');
    } else {
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (!r) continue;
        console.log(`\n${i + 1}. [${r.type}] ${r.source || 'inline'}`);
        console.log(`   Relevance: ${(r.relevance * 100).toFixed(1)}%`);
        console.log(`   Preview: ${r.content.slice(0, 100).replace(/\n/g, ' ')}...`);
      }
    }
    console.log('\n');
  }

  // Show final stats
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('                         FINAL STATS                                ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const finalStats = rag.getStats();
  console.log(`Documents indexed: ${finalStats.total_documents}`);
  console.log(`Chunks indexed: ${finalStats.total_chunks}`);
  console.log(`Total searches: ${finalStats.total_searches}`);
  console.log(`Avg search latency: ${finalStats.average_search_latency_ms}ms`);
  console.log(`Total embedding tokens: ${finalStats.total_embedding_tokens}`);

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                              DONE                                  ');
  console.log('═══════════════════════════════════════════════════════════════════');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
