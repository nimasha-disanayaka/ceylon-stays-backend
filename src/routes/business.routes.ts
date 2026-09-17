import { Router } from 'express';
import {
  createBusiness,
  getMyBusinesses,
  getBusinessById,
  updateBusiness,
  deleteBusiness,
  getNearbyBusinesses,
} from '../controllers/business.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

// Public Specific Routes
router.get('/nearby', getNearbyBusinesses);

// Protected Owner-Only Routes
router.get('/my-businesses', authenticate, authorize(['OWNER']), getMyBusinesses);
router.post('/', authenticate, authorize(['OWNER']), createBusiness);
router.put('/:id', authenticate, authorize(['OWNER']), updateBusiness);
router.delete('/:id', authenticate, authorize(['OWNER']), deleteBusiness);

// Public Parameter Route (MUST come last)
router.get('/:id', getBusinessById);

export default router;

