/**
 * Prisma client singleton. Every route/service imports the database through
 * this file, so the JSON-array helpers below (used for Lawyer.tags/specs/langs,
 * which SQLite has no native array type for) live in exactly one place.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function toArr(json) {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function fromArr(arr) {
  return JSON.stringify(Array.isArray(arr) ? arr : []);
}

/**
 * Convert a raw Lawyer row (tags/specs/langs stored as JSON strings) into
 * API shape. barIdStoredPath is the raw disk filename, never sent to any
 * client (same convention as documents.js's storedPath) - the admin bar-id
 * download route reads it straight from Prisma, not through this function.
 */
function serializeLawyer(l) {
  if (!l) return l;
  const { barIdStoredPath, ...rest } = { ...l, tags: toArr(l.tags), specs: toArr(l.specs), langs: toArr(l.langs) };
  return rest;
}

/** Same as serializeLawyer, but strips contact details, for public/unauthenticated responses. */
function serializePublicLawyer(l) {
  if (!l) return l;
  const { phone, email, rejectionReason, barIdOriginalName, barIdMimeType, ...rest } = serializeLawyer(l);
  return rest;
}

module.exports = { prisma, toArr, fromArr, serializeLawyer, serializePublicLawyer };
