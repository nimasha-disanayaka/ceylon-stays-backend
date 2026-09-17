import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { registerSchema, loginSchema } from '../utils/validation';
import { hashPassword, comparePassword } from '../utils/password';
import { generateToken } from '../utils/jwt';

/**
 * @route POST /api/auth/register
 * @desc  Register a new user (OWNER or FOREIGNER)
 */
export const register = async (req: Request, res: Response) => {
  try {
    // 1. Validate Input Body with Zod
    const validationResult = registerSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation Error',
        details: validationResult.error.flatten().fieldErrors,
      });
    }

    const { email, password, name, phone, role } = validationResult.data;

    // 2. Check if Email Already Exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    // 3. Hash Password
    const passwordHash = await hashPassword(password);

    // 4. Create User in Database
    const newUser = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        phone,
        role,
      },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        createdAt: true,
      },
    });

    // 5. Generate JWT Access Token
    const token = generateToken({ userId: newUser.id, role: newUser.role });

    return res.status(201).json({
      message: 'User registered successfully',
      user: newUser,
      token,
    });
  } catch (error) {
    console.error('Registration Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * @route POST /api/auth/login
 * @desc  Authenticate user & return JWT token
 */
export const login = async (req: Request, res: Response) => {
  try {
    // 1. Validate Input Body with Zod
    const validationResult = loginSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation Error',
        details: validationResult.error.flatten().fieldErrors,
      });
    }

    const { email, password } = validationResult.data;

    // 2. Find User by Email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // 3. Compare Password Hash
    const isPasswordValid = await comparePassword(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // 4. Generate JWT Token
    const token = generateToken({ userId: user.id, role: user.role });

    return res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        createdAt: user.createdAt,
      },
      token,
    });
  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * @route GET /api/auth/me
 * @desc  Get current logged in user profile (Protected)
 */
export const getMe = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.status(200).json({ user });
  } catch (error) {
    console.error('GetMe Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
