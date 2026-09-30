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

// Owner Routes
router.get('/my-businesses', getMyBusinesses);
router.post('/', createBusiness);
router.put('/:id', updateBusiness);
router.delete('/:id', deleteBusiness);

// Public Parameter Route (MUST come last)
router.get('/:id', getBusinessById);

export default router;

