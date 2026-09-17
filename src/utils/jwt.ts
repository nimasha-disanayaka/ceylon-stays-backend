import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-change-in-production-2026';
const JWT_EXPIRES_IN = '7d'; // Token valid for 7 days

export interface TokenPayload {
  userId: string;
  role: Role;
}

/**
 * Generates a signed JWT access token containing userId and role.
 */
export const generateToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
};

/**
 * Verifies a JWT token signature and returns decoded payload.
 */
export const verifyToken = (token: string): TokenPayload => {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
};
