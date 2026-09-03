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

/** Convert a raw Lawyer row (tags/specs/langs stored as JSON strings) into API shape. */
function serializeLawyer(l) {
  if (!l) return l;
  return { ...l, tags: toArr(l.tags), specs: toArr(l.specs), langs: toArr(l.langs) };
}

/** Same as serializeLawyer, but strips contact details, for public/unauthenticated responses. */
function serializePublicLawyer(l) {
  if (!l) return l;
  const { phone, email, rejectionReason, ...rest } = serializeLawyer(l);
  return rest;
}

module.exports = { prisma, toArr, fromArr, serializeLawyer, serializePublicLawyer };
