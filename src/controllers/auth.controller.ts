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

    // 2. Check if Email Already Exists in PostgreSQL
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    // 3. Hash Password
    const passwordHash = await hashPassword(password);

    // 4. Create User in PostgreSQL
    const dbUser = await prisma.user.create({
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
    const token = generateToken({ userId: dbUser.id, role: dbUser.role });

    return res.status(201).json({
      message: 'User registered successfully',
      user: dbUser,
      token,
    });
  } catch (error: any) {
    console.error('Registration Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error?.message || 'Database error during registration' });
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

    // 2. Lookup user strictly in PostgreSQL
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // 3. Verify Password Hash
    const isPasswordValid = await comparePassword(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // 4. Generate JWT Access Token
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
  } catch (error: any) {
    console.error('Login Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error?.message || 'Database error during authentication' });
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
  } catch (error: any) {
    console.error('Get Me Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error?.message || 'Database error fetching profile' });
  }
};

/**
 * @route PUT /api/auth/profile
 * @desc  Update user profile details
 */
export const updateProfile = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { name, phone } = req.body;

    const updatedUser = await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        ...(name && { name }),
        ...(phone !== undefined && { phone }),
      },
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

    return res.status(200).json({
      message: 'Profile updated successfully',
      user: updatedUser,
    });
  } catch (error: any) {
    console.error('Update Profile Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error?.message || 'Database error updating profile' });
  }
};

/**
 * @route PUT /api/auth/change-password
 * @desc  Change host password
 */
export const changePassword = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValid = await comparePassword(currentPassword, user.passwordHash);
    if (!isValid) {
      return res.status(400).json({ error: 'Current password does not match' });
    }

    const newHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    return res.status(200).json({ message: 'Password changed successfully' });
  } catch (error: any) {
    console.error('Change Password Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error?.message || 'Database error changing password' });
  }
};

