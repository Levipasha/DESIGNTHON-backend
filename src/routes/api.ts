import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { 
  Users, Teams, Coupons, Notifications, Payments, Invites,
  User, Team, Coupon, Notification, PaymentLog, TeamInvite
} from '../config/db';
import { sendEmail, getEmailTemplate } from '../config/mail';
import { broadcastEvent } from '../index';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'designthon-secret-key-2026';

export const HIDDEN_TEST_EMAILS = ['admin@retrend.com', 'admnklnklin@retrend.com', 'abbupasha61@gmail.com'];
export const HIDDEN_TEST_NAMES = ['p9uy87ghuoijpok opihguyftc', 'hjjjkkj', 'skyweb'];

export const isRealParticipant = (u: User) => {
  if (u.role === 'admin') return false;
  const email = (u.email || '').toLowerCase().trim();
  const name = (u.name || '').toLowerCase().trim();
  if (HIDDEN_TEST_EMAILS.includes(email) || HIDDEN_TEST_NAMES.includes(name)) return false;
  if (email.endsWith('@retrend.com')) return false;
  return true;
};

export const isConfirmedParticipant = (u: User) => {
  if (!isRealParticipant(u)) return false;
  return u.paymentStatus === 'paid' || u.registrationStatus === 'CONFIRMED' || u.registrationStatus === 'PAYMENT_COMPLETED';
};

export function generateRegistrationId(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `DT26-${code}`;
}

// Extend Express Request interface to include user information
export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: 'admin' | 'team-leader' | 'participant';
    adminRole?: 'super-admin' | 'viewer';
  };
}

export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Authorization token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; role: 'admin' | 'team-leader' | 'participant'; adminRole?: 'super-admin' | 'viewer' };
    
    let user;
    if (decoded.id === 'admin-local') {
      user = { id: 'admin-local', role: 'admin', adminRole: 'super-admin' as const };
    } else {
      user = await Users.findOne({ id: decoded.id });
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
    }

    req.user = {
      id: user.id,
      role: user.role as 'admin' | 'team-leader' | 'participant',
      adminRole: user.adminRole || (decoded as any).adminRole || 'super-admin'
    };
    next();
  } catch (error) {
    return res.status(403).json({ message: 'Invalid or expired token' });
  }
};

// Admin Middleware (Viewers and Super Admins allowed)
export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// Super Admin Middleware (Only Full Admins with Edit/Mutate permissions)
export const requireFullAdmin = async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }

  let adminRole = req.user.adminRole;
  if (!adminRole && req.user.id !== 'admin-local') {
    const dbUser = await Users.findOne({ id: req.user.id });
    if (dbUser) adminRole = dbUser.adminRole;
  }

  if (adminRole === 'viewer') {
    return res.status(403).json({
      message: 'Access Denied: Read-only administrator accounts (Viewers) are not permitted to perform edit or modifying actions.'
    });
  }
  next();
};

// --- REGISTRATION & AUTHENTICATION ENDPOINTS ---

// Phase 1 Registration: Save Participant Details & Generate Registration ID
router.post('/register/phase1', async (req: Request, res: Response) => {
  const { name, email, phone, college, branch, year, gender, linkedin, portfolio } = req.body;

  // 1. Validate required fields
  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Full name is required' });
  }
  if (!email || !email.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) {
    return res.status(400).json({ message: 'A valid email address is required' });
  }
  const cleanPhone = (phone || '').replace(/\D/g, '');
  if (!cleanPhone || cleanPhone.length < 10) {
    return res.status(400).json({ message: 'A valid 10-digit phone number is required' });
  }
  if (!college || !college.trim()) {
    return res.status(400).json({ message: 'College/Organization name is required' });
  }
  if (!branch || !branch.trim()) {
    return res.status(400).json({ message: 'Branch / Specialization is required' });
  }
  if (!year || !year.trim()) {
    return res.status(400).json({ message: 'Current academic year is required' });
  }
  if (!gender || !gender.trim()) {
    return res.status(400).json({ message: 'Gender is required' });
  }
  if (!linkedin || !linkedin.trim()) {
    return res.status(400).json({ message: 'LinkedIn URL is required' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  let user = await Users.findOne({ email: normalizedEmail });

  if (user) {
    // If user has already paid / confirmed
    if (user.paymentStatus === 'paid' || user.registrationStatus === 'CONFIRMED') {
      const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
      return res.status(200).json({
        alreadyConfirmed: true,
        message: 'You have already completed registration & payment!',
        token,
        user,
        registrationId: user.registrationId || user.id
      });
    }

    // Existing pending user: update details, assign readable registrationId if missing
    const regId = user.registrationId || generateRegistrationId();
    await Users.updateOne(user.id, {
      registrationId: regId,
      name: name.trim(),
      phone: cleanPhone,
      college: college.trim(),
      branch: branch.trim(),
      year: year.trim(),
      gender: gender.trim(),
      linkedin: linkedin.trim(),
      portfolio: portfolio ? portfolio.trim() : undefined,
      registrationStatus: 'DETAILS_SUBMITTED',
      currentPhase: 'PAYMENT',
      originalAmount: 1000,
      updatedAt: new Date().toISOString()
    });

    user = await Users.findOne({ id: user.id });
  } else {
    // New participant registration record
    const regId = generateRegistrationId();
    user = await Users.create({
      registrationId: regId,
      name: name.trim(),
      email: normalizedEmail,
      phone: cleanPhone,
      college: college.trim(),
      branch: branch.trim(),
      year: year.trim(),
      gender: gender.trim(),
      linkedin: linkedin.trim(),
      portfolio: portfolio ? portfolio.trim() : undefined,
      role: 'participant',
      registrationStatus: 'DETAILS_SUBMITTED',
      currentPhase: 'PAYMENT',
      paymentStatus: 'pending',
      originalAmount: 1000,
      discountAmount: 0,
      amountPaid: 0,
      checkedIn: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  if (!user) {
    return res.status(500).json({ message: 'Failed to create or retrieve user registration.' });
  }

  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

  // Broadcast realtime update to admin
  broadcastEvent('registration_created', { user });
  broadcastEvent('admin_stats_updated');

  return res.status(201).json({
    success: true,
    message: 'Phase 1 registration details saved successfully.',
    token,
    user,
    registrationId: user.registrationId || `DT26-${user.id.substring(0, 6).toUpperCase()}`
  });
});

// 1. Send OTP (Simulated)
router.post('/auth/otp-send', async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }
  
  // Simulated OTP: 123456 for ease of testing
  console.log(`[OTP] Sent verification code 123456 to ${email}`);
  return res.json({ message: 'Verification code sent. Use code: 123456 to login.' });
});

// 2. Verify OTP (Handles both Login & Signup)
router.post('/auth/otp-verify', async (req: Request, res: Response) => {
  const { email, code, name, phone, college, branch, year, gender, linkedin, portfolio } = req.body;

  if (!email || !code) {
    return res.status(400).json({ message: 'Email and OTP code are required' });
  }

  if (code !== '123456') {
    return res.status(400).json({ message: 'Invalid verification code' });
  }

  let user = await Users.findOne({ email: email.toLowerCase().trim() });

  if (!user) {
    // If sign up details are missing, tell the frontend to collect them
    if (!name || !phone || !college || !branch || !year || !gender) {
      return res.status(202).json({ 
        newUser: true, 
        message: 'New user: Please complete your registration details.' 
      });
    }

    // Create User (Participant by default)
    const regId = generateRegistrationId();
    user = await Users.create({
      registrationId: regId,
      name,
      email: email.toLowerCase().trim(),
      phone,
      college,
      branch,
      year,
      gender,
      linkedin,
      portfolio,
      role: 'participant',
      registrationStatus: 'DETAILS_SUBMITTED',
      currentPhase: 'PAYMENT',
      paymentStatus: 'pending',
      amountPaid: 0,
      checkedIn: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    broadcastEvent('registration_created', { user });
    broadcastEvent('admin_stats_updated');
  }

  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  return res.json({ token, user });
});

export const FULL_ADMIN_EMAILS = [
  'abbupasha61@gmail.com',
  'vamshi.c2002@gmail.com',
  'skywebdevelopers123@gmail.com',
  'official@skywebdev.xyz',
  'admin@designathon.com',
  'admin@designthon.com'
];

export const VIEWER_ADMIN_EMAILS = [
  'marupakarevanth@gmail.com',
  'pudurukoushik@gmail.com'
];

export const getAdminRoleForEmail = (email: string): 'super-admin' | 'viewer' | null => {
  const normalized = (email || '').toLowerCase().trim();
  if (FULL_ADMIN_EMAILS.some(e => e.toLowerCase() === normalized)) return 'super-admin';
  if (VIEWER_ADMIN_EMAILS.some(e => e.toLowerCase() === normalized)) return 'viewer';

  const envSuper = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (envSuper.includes(normalized)) return 'super-admin';

  const envViewer = (process.env.VIEWER_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (envViewer.includes(normalized)) return 'viewer';

  return null;
};

// 2.5. Admin Login (Password-only for local running)
router.post('/auth/admin-login', async (req: Request, res: Response) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ message: 'Password is required' });
  }

  // Allow "admin" or "admin123" for local run
  if (password !== 'admin' && password !== 'admin123') {
    return res.status(401).json({ message: 'Invalid admin password' });
  }

  const user = {
    id: 'admin-local',
    name: 'Local Admin',
    email: 'admin@local.com',
    role: 'admin' as const,
    adminRole: 'super-admin' as const,
    paymentStatus: 'paid' as const,
    checkedIn: true
  };

  const token = jwt.sign({ id: user.id, role: user.role, adminRole: user.adminRole }, JWT_SECRET, { expiresIn: '7d' });
  return res.json({ token, user });
});

// 2.6. Admin Google Login with Email Whitelist & Permissions
router.post('/auth/admin-google-login', async (req: Request, res: Response) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ message: 'Firebase ID token is required.' });
  }

  try {
    const firebaseApiKey = process.env.FIREBASE_API_KEY;
    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );

    if (!verifyRes.ok) {
      const errBody = await verifyRes.json() as any;
      console.error('[Admin Google Login] Token verification failed:', errBody);
      return res.status(401).json({ message: 'Invalid or expired Google token.' });
    }

    const verifyData = await verifyRes.json() as any;
    const googleUser = verifyData?.users?.[0];
    if (!googleUser) {
      return res.status(401).json({ message: 'Could not retrieve Google user info.' });
    }

    const email: string = (googleUser.email || '').toLowerCase().trim();
    const name: string = googleUser.displayName || email.split('@')[0];

    const adminRole = getAdminRoleForEmail(email);

    if (!adminRole) {
      console.warn(`[Admin Google Login] Blocked unauthorized attempt from email: ${email}`);
      return res.status(403).json({
        message: `Access Denied: The account ${email} is not authorized to access the Admin Panel. Only permitted administrator accounts are allowed.`
      });
    }

    // Admin email is authorized. Find or create the admin user in DB
    let user = await Users.findOne({ email } as any);
    if (!user) {
      user = await Users.create({
        name,
        email,
        phone: '0000000000',
        college: 'DESIGNATHON Core Admin',
        branch: 'Administration',
        year: 'N/A',
        gender: 'Other',
        linkedin: 'https://linkedin.com',
        role: 'admin',
        adminRole,
        paymentStatus: 'paid',
        registrationStatus: 'CONFIRMED',
        currentPhase: 'CONFIRMATION',
        amountPaid: 0,
        checkedIn: true,
        createdAt: new Date().toISOString()
      });
    } else {
      await Users.updateOne(user.id, { role: 'admin', adminRole });
      user.role = 'admin';
      user.adminRole = adminRole;
    }

    const token = jwt.sign({ id: user.id, role: 'admin', adminRole }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ success: true, token, user });

  } catch (err) {
    console.error('[Admin Google Login] Error:', err);
    return res.status(500).json({ message: 'Server error during admin Google authentication.' });
  }
});

// 3. Google Login — verify Firebase ID token
router.post('/auth/google-login', async (req: Request, res: Response) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ message: 'Firebase ID token is required.' });
  }

  try {
    // Verify token with Google's Identity Toolkit API
    const firebaseApiKey = process.env.FIREBASE_API_KEY;
    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );

    if (!verifyRes.ok) {
      const errBody = await verifyRes.json() as any;
      console.error('[Google Login] Token verification failed:', errBody);
      return res.status(401).json({ message: 'Invalid or expired Google token.' });
    }

    const verifyData = await verifyRes.json() as any;
    const googleUser = verifyData?.users?.[0];
    if (!googleUser) {
      return res.status(401).json({ message: 'Could not retrieve Google user info.' });
    }

    const email: string = (googleUser.email || '').toLowerCase().trim();
    const name: string = googleUser.displayName || email.split('@')[0];

    // Check if user is an authorized admin
    const adminRole = getAdminRoleForEmail(email);

    // Check if user already exists in DB
    let user = await Users.findOne({ email } as any);

    if (adminRole) {
      if (!user) {
        user = await Users.create({
          name,
          email,
          phone: '0000000000',
          college: 'DESIGNATHON Core Admin',
          branch: 'Administration',
          year: 'N/A',
          gender: 'Other',
          linkedin: 'https://linkedin.com',
          role: 'admin',
          adminRole,
          paymentStatus: 'paid',
          registrationStatus: 'CONFIRMED',
          currentPhase: 'CONFIRMATION',
          amountPaid: 0,
          checkedIn: true,
          createdAt: new Date().toISOString()
        });
      } else if (user.role !== 'admin' || user.adminRole !== adminRole) {
        await Users.updateOne(user.id, { role: 'admin', adminRole });
        user.role = 'admin';
        user.adminRole = adminRole;
      }
    }

    if (!user) {
      // New user — redirect to registration with prefilled info
      return res.status(202).json({
        newUser: true,
        email,
        name,
        message: 'Google login success: Please complete registration.',
      });
    }

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token, user });

  } catch (err) {
    console.error('[Google Login] Error:', err);
    return res.status(500).json({ message: 'Server error during Google authentication.' });
  }
});

// 4. Get Current User profile
router.get('/auth/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
  
  if (req.user.id === 'admin-local') {
    return res.json({
      id: 'admin-local',
      name: 'Local Admin',
      email: 'admin@local.com',
      role: 'admin',
      paymentStatus: 'paid',
      checkedIn: true
    });
  }

  const user = await Users.findOne({ id: req.user.id });
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }
  return res.json(user);
});


// --- PUBLIC TEAMS ENDPOINTS ---

// 1. Get List of Public Teams (Search, filter, sort)
router.get('/public/teams', async (req: Request, res: Response) => {
  const { search, college, slotsAvailable, sort } = req.query;

  let allTeams = await Teams.find();
  
  // Attach leader names to the response for display
  const teamsWithLeaderDetails = await Promise.all(allTeams.map(async (t) => {
    const leader = await Users.findOne({ id: t.leaderId });
    return {
      ...t,
      leaderName: leader ? leader.name : 'Unknown Leader',
      memberCount: t.members.length
    };
  }));

  let filtered = teamsWithLeaderDetails;

  // Search filter
  if (search) {
    const term = String(search).toLowerCase();
    filtered = filtered.filter(t => 
      t.name.toLowerCase().includes(term) || 
      t.description.toLowerCase().includes(term) ||
      t.leaderName.toLowerCase().includes(term)
    );
  }

  // College filter
  if (college) {
    const clg = String(college).toLowerCase();
    filtered = filtered.filter(t => t.college.toLowerCase() === clg);
  }

  // Slots available filter
  if (slotsAvailable === 'true') {
    filtered = filtered.filter(t => t.remainingSlots > 0 && t.status === 'open');
  }

  // Sort
  if (sort === 'newest') {
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } else {
    // Default alphabetical
    filtered.sort((a, b) => a.name.localeCompare(b.name));
  }

  return res.json(filtered);
});

// 2. Get distinct college names that are participating (confirmed only)
router.get('/public/colleges', async (req: Request, res: Response) => {
  const usersList = await Users.find(isConfirmedParticipant);
  const collegesSet = new Set(usersList.map(u => u.college).filter(Boolean));
  return res.json(Array.from(collegesSet));
});

// 2.3 Get List of Public Participants (Search, filter, sort) - ONLY Confirmed/Paid Participants
router.get('/public/participants', async (req: Request, res: Response) => {
  const { search, college, lookingForTeam, sort } = req.query;

  const allUsers = await Users.find(isConfirmedParticipant);
  const allTeams = await Teams.find();
  const teamsMap = new Map(allTeams.map(t => [t.id, t.name]));

  let participants = allUsers.map(u => ({
    id: u.id,
    registrationId: u.registrationId || `DT26-${u.id.substring(0, 6).toUpperCase()}`,
    name: u.name,
    college: u.college,
    branch: u.branch,
    year: u.year,
    gender: u.gender,
    linkedin: u.linkedin,
    portfolio: u.portfolio,
    teamId: u.teamId,
    teamName: u.teamId ? (teamsMap.get(u.teamId) || 'In Team') : undefined,
    teamRole: u.teamRole,
    paymentStatus: u.paymentStatus,
    registrationStatus: u.registrationStatus || 'CONFIRMED',
    createdAt: u.createdAt
  }));

  // Search filter
  if (search) {
    const term = String(search).toLowerCase();
    participants = participants.filter(p =>
      p.name.toLowerCase().includes(term) ||
      (p.college && p.college.toLowerCase().includes(term)) ||
      (p.branch && p.branch.toLowerCase().includes(term)) ||
      (p.teamName && p.teamName.toLowerCase().includes(term)) ||
      (p.registrationId && p.registrationId.toLowerCase().includes(term))
    );
  }

  // College filter
  if (college) {
    const clg = String(college).toLowerCase();
    participants = participants.filter(p => p.college && p.college.toLowerCase() === clg);
  }

  // Looking for team filter
  if (lookingForTeam === 'true') {
    participants = participants.filter(p => !p.teamId);
  }

  // Sort
  if (sort === 'newest') {
    participants.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } else {
    participants.sort((a, b) => a.name.localeCompare(b.name));
  }

  return res.json(participants);
});

// 2.5 Get details of a single team by ID
router.get('/public/teams/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const team = await Teams.findOne({ id });
  if (!team) return res.status(404).json({ message: 'Team not found' });

  const leader = await Users.findOne({ id: team.leaderId });
  return res.json({
    ...team,
    leaderName: leader ? leader.name : 'Unknown Leader',
    memberCount: team.members.length
  });
});


// --- COUPONS ---

// 1. Validate Coupon Code
router.post('/coupons/validate', async (req: Request, res: Response) => {
  const { code, college } = req.body;
  
  if (!code || !code.trim()) {
    return res.status(400).json({ valid: false, message: 'Coupon code is required' });
  }

  const cleanCode = code.toUpperCase().trim();
  const coupon = await Coupons.findOne({ code: cleanCode });
  
  if (!coupon || !coupon.isActive) {
    return res.status(400).json({ valid: false, message: 'Invalid or inactive coupon code' });
  }

  if (new Date(coupon.expiryDate).getTime() < Date.now()) {
    return res.status(400).json({ valid: false, message: 'Coupon code has expired' });
  }

  if (coupon.usageCount >= coupon.usageLimit) {
    return res.status(400).json({ valid: false, message: 'Coupon usage limit reached' });
  }

  // College restriction check
  if (coupon.collegeName && college) {
    if (!college.toLowerCase().includes(coupon.collegeName.toLowerCase()) && !coupon.collegeName.toLowerCase().includes(college.toLowerCase())) {
      return res.status(400).json({ 
        valid: false, 
        message: `This coupon is only valid for participants from ${coupon.collegeName}` 
      });
    }
  }

  const basePrice = 1000;
  let discountAmount = 0;

  if (coupon.discountType === 'percentage') {
    discountAmount = Math.round((basePrice * coupon.discountValue) / 100);
  } else {
    discountAmount = Math.min(basePrice, coupon.discountValue);
  }

  const finalPrice = Math.max(0, basePrice - discountAmount);

  return res.json({
    valid: true,
    code: coupon.code,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    originalAmount: basePrice,
    discountAmount,
    finalPrice
  });
});


// --- PAYMENTS & REGISTRATION ---

// 1. Create Order (Real Razorpay integration)
router.post('/payments/create-order', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { amount, couponCode } = req.body;
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const user = await Users.findOne({ id: userId });
  if (!user) return res.status(404).json({ message: 'User not found' });

  let discountAmount = 0;
  let finalAmount = typeof amount === 'number' ? amount : 1000;

  if (couponCode) {
    const coupon = await Coupons.findOne({ code: couponCode.toUpperCase().trim() });
    if (coupon && coupon.isActive && coupon.usageCount < coupon.usageLimit) {
      if (coupon.discountType === 'percentage') {
        discountAmount = Math.round((1000 * coupon.discountValue) / 100);
      } else {
        discountAmount = Math.min(1000, coupon.discountValue);
      }
      finalAmount = Math.max(0, 1000 - discountAmount);
    }
  }

  // Update user state to PAYMENT_PENDING
  await Users.updateOne(user.id, {
    registrationStatus: 'PAYMENT_PENDING',
    currentPhase: 'PAYMENT',
    couponUsed: couponCode || undefined,
    originalAmount: 1000,
    discountAmount,
    updatedAt: new Date().toISOString()
  });

  broadcastEvent('admin_stats_updated');
  broadcastEvent('registration_updated', { userId: user.id, status: 'PAYMENT_PENDING' });

  try {
    const keyId = process.env.key_id;
    const keySecret = process.env.key_secret;

    if (!keyId || !keySecret) {
      return res.status(500).json({ message: 'Razorpay API credentials are not configured on the backend' });
    }

    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64')
      },
      body: JSON.stringify({
        amount: Math.round(finalAmount * 100), // Razorpay works in paise
        currency: 'INR',
        receipt: `receipt_${uuidv4().substring(0, 14)}`
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Razorpay order creation error:', errorData);
      return res.status(500).json({ message: 'Failed to create order with Razorpay', error: errorData });
    }

    const order: any = await response.json();
    return res.json({
      id: order.id,
      currency: order.currency,
      amount: order.amount,
      finalAmount
    });
  } catch (error: any) {
    console.error('Error creating Razorpay order:', error);
    return res.status(500).json({ message: 'Internal server error while creating payment order', error: error.message });
  }
});

// 2. Capture and Verify Payment (Real Razorpay Verification)
router.post('/payments/verify', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature, couponCode, amount } = req.body;
  const userId = req.user?.id;

  if (!userId) return res.status(401).json({ message: 'Unauthorized' });
  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    return res.status(400).json({ message: 'Missing required Razorpay payment verification parameters' });
  }

  // Verify Razorpay signature
  const keySecret = process.env.key_secret;
  if (!keySecret) {
    return res.status(500).json({ message: 'Razorpay secret key is not configured on the backend' });
  }

  const generated_signature = crypto
    .createHmac('sha256', keySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (generated_signature !== razorpay_signature) {
    await Users.updateOne(userId, {
      registrationStatus: 'PAYMENT_FAILED',
      paymentStatus: 'failed',
      updatedAt: new Date().toISOString()
    });
    broadcastEvent('admin_stats_updated');
    broadcastEvent('payment_updated', { userId, status: 'PAYMENT_FAILED' });
    return res.status(400).json({ message: 'Payment verification failed: Signature mismatch' });
  }

  // Update User Payment Status
  const user = await Users.findOne({ id: userId });
  if (!user) return res.status(404).json({ message: 'User not found' });

  // Calculate discount & update coupon usage
  let discountAmount = 0;
  if (couponCode) {
    const coupon = await Coupons.findOne({ code: couponCode.toUpperCase().trim() });
    if (coupon) {
      if (coupon.discountType === 'percentage') {
        discountAmount = Math.round((1000 * coupon.discountValue) / 100);
      } else {
        discountAmount = Math.min(1000, coupon.discountValue);
      }
      await Coupons.updateOne(coupon.id, { usageCount: coupon.usageCount + 1 });
    }
  }

  const finalPaidAmount = typeof amount === 'number' ? amount : Math.max(0, 1000 - discountAmount);

  // Log the payment
  const paymentLog = await Payments.create({
    razorpayPaymentId: razorpay_payment_id,
    razorpayOrderId: razorpay_order_id,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    amount: finalPaidAmount,
    status: 'success',
    couponUsed: couponCode || undefined,
    createdAt: new Date().toISOString()
  });

  // Update user profile
  await Users.updateOne(user.id, {
    paymentStatus: 'paid',
    registrationStatus: 'CONFIRMED',
    currentPhase: 'CONFIRMATION',
    paymentId: paymentLog.razorpayPaymentId,
    couponUsed: couponCode || undefined,
    discountAmount,
    originalAmount: 1000,
    amountPaid: finalPaidAmount,
    updatedAt: new Date().toISOString()
  });

  // Create real-time notification
  await Notifications.create({
    recipientType: 'individual',
    recipientTarget: user.id,
    title: 'Payment Successful & Confirmed',
    message: `Thank you, ${user.name}! Your payment of ₹${finalPaidAmount} has been processed successfully. Your registration ID is ${user.registrationId || user.id}.`,
    type: 'success',
    readBy: [],
    createdAt: new Date().toISOString()
  });

  // Broadcast realtime updates to connected sockets & admin
  broadcastEvent('payment_updated', { userId: user.id, status: 'CONFIRMED' });
  broadcastEvent('admin_stats_updated');

  // Send email confirmation
  try {
    const origin = req.get('origin') || 'http://localhost:3000';
    const regDisplayId = user.registrationId || `DT26-${user.id.substring(0, 6).toUpperCase()}`;
    const ticketHtml = `
      <p>Hello <strong>${user.name}</strong>,</p>
      <p>Your registration payment has been verified. Here is your entry pass and receipt details:</p>
      
      <div class="ticket-card">
        <div class="ticket-header">ENTRY PASS & RECEIPT</div>
        <div class="ticket-row">
          <span class="ticket-label">Registration ID</span>
          <span class="ticket-value" style="font-family: monospace; font-weight: bold; color: #a78bfa;">${regDisplayId}</span>
        </div>
        <div class="ticket-row">
          <span class="ticket-label">Attendee Name</span>
          <span class="ticket-value">${user.name}</span>
        </div>
        <div class="ticket-row">
          <span class="ticket-label">Email Address</span>
          <span class="ticket-value">${user.email}</span>
        </div>
        <div class="ticket-row">
          <span class="ticket-label">College</span>
          <span class="ticket-value">${user.college}</span>
        </div>
        <div class="ticket-row">
          <span class="ticket-label">Transaction ID</span>
          <span class="ticket-value" style="font-family: monospace;">${paymentLog.razorpayPaymentId}</span>
        </div>
        ${couponCode ? `
        <div class="ticket-row">
          <span class="ticket-label">Coupon Applied</span>
          <span class="ticket-value">${couponCode} (-₹${discountAmount})</span>
        </div>` : ''}
        <div class="ticket-row ticket-total">
          <span>Amount Paid</span>
          <span>₹${finalPaidAmount}</span>
        </div>
        
        <div class="qr-container">
          <p style="margin-bottom: 10px; font-size: 11px; color: #71717a;">SCAN FOR CHECK-IN</p>
          <img src="https://quickchart.io/qr?text=${encodeURIComponent(user.id)}&size=120&margin=1" class="qr-img" alt="Entry QR" />
        </div>
      </div>

      <p><strong>Next Steps:</strong></p>
      <ul>
        <li>Log in to your dashboard to create or join a team (teams require 3-4 members).</li>
        <li>Present the QR code above at the venue check-in desk on Saturday, Sept 12, 2026.</li>
      </ul>
      
      <div class="cta-container">
        <a href="${origin}/login" class="cta-button">Go to Dashboard</a>
      </div>
    `;
    const mailHtml = getEmailTemplate('Registration Confirmed!', ticketHtml);
    await sendEmail(user.email, 'DESIGNATHON 2026 - Registration Confirmed', mailHtml);
  } catch (mailErr) {
    console.error('[Mail Error] Failed to send payment confirmation email:', mailErr);
  }

  const updatedUser = await Users.findOne({ id: user.id });
  return res.json({ success: true, message: 'Payment completed successfully', user: updatedUser });
});

// 3. Verify Free / 100% Discount Registration
router.post('/payments/verify-free', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { couponCode } = req.body;
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const user = await Users.findOne({ id: userId });
  if (!user) return res.status(404).json({ message: 'User not found' });

  if (!couponCode) {
    return res.status(400).json({ message: 'Coupon code is required' });
  }

  const coupon = await Coupons.findOne({ code: couponCode.toUpperCase().trim() });
  if (!coupon || !coupon.isActive) {
    return res.status(400).json({ message: 'Invalid or inactive coupon code' });
  }

  if (new Date(coupon.expiryDate).getTime() < Date.now()) {
    return res.status(400).json({ message: 'Coupon has expired' });
  }

  if (coupon.usageCount >= coupon.usageLimit) {
    return res.status(400).json({ message: 'Coupon usage limit reached' });
  }

  // College restriction check
  if (coupon.collegeName && user.college) {
    if (!user.college.toLowerCase().includes(coupon.collegeName.toLowerCase()) && !coupon.collegeName.toLowerCase().includes(user.college.toLowerCase())) {
      return res.status(400).json({ message: `This coupon is only valid for participants from ${coupon.collegeName}` });
    }
  }

  // Validate that discount is truly 100% (or fixed 1000)
  const isHundredPercent = (coupon.discountType === 'percentage' && coupon.discountValue >= 100) || (coupon.discountType === 'fixed' && coupon.discountValue >= 1000);
  if (!isHundredPercent) {
    return res.status(400).json({ message: 'This coupon does not provide 100% discount' });
  }

  // Increment usage count
  await Coupons.updateOne(coupon.id, { usageCount: coupon.usageCount + 1 });

  const freePaymentId = `FREE-${uuidv4().substring(0, 8).toUpperCase()}`;

  // Log payment
  await Payments.create({
    razorpayPaymentId: freePaymentId,
    razorpayOrderId: `ORDER-${freePaymentId}`,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    amount: 0,
    status: 'success',
    couponUsed: coupon.code,
    createdAt: new Date().toISOString()
  });

  // Update user profile
  await Users.updateOne(user.id, {
    paymentStatus: 'paid',
    registrationStatus: 'CONFIRMED',
    currentPhase: 'CONFIRMATION',
    paymentId: freePaymentId,
    couponUsed: coupon.code,
    originalAmount: 1000,
    discountAmount: 1000,
    amountPaid: 0,
    updatedAt: new Date().toISOString()
  });

  // Notification
  await Notifications.create({
    recipientType: 'individual',
    recipientTarget: user.id,
    title: 'Registration Confirmed (100% Coupon Applied)',
    message: `Welcome, ${user.name}! Your 100% coupon ${coupon.code} was applied successfully. Your registration ID is ${user.registrationId || user.id}.`,
    type: 'success',
    readBy: [],
    createdAt: new Date().toISOString()
  });

  // Broadcast realtime update
  broadcastEvent('payment_updated', { userId: user.id, status: 'CONFIRMED' });
  broadcastEvent('admin_stats_updated');

  const updatedUser = await Users.findOne({ id: user.id });
  return res.json({ success: true, message: 'Registration confirmed with 100% coupon', user: updatedUser });
});

// 4. Update Payment & Phase Status (e.g. on dismissal or failure)
router.post('/payments/status-update', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { status, phase } = req.body;
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const validStatuses = ['DETAILS_SUBMITTED', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'CANCELLED'];
  if (status && validStatuses.includes(status)) {
    await Users.updateOne(userId, {
      registrationStatus: status,
      paymentStatus: status === 'PAYMENT_FAILED' ? 'failed' : 'pending',
      currentPhase: phase || 'PAYMENT',
      updatedAt: new Date().toISOString()
    });
    broadcastEvent('admin_stats_updated');
    broadcastEvent('registration_updated', { userId, status });
  }

  return res.json({ success: true });
});


// --- TEAMS ENDPOINTS (AUTHENTICATED) ---

// 1. Create a Team
router.post('/teams/create', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { name, description, logoUrl } = req.body;
  const userId = req.user?.id;

  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const user = await Users.findOne({ id: userId });
  if (!user) return res.status(404).json({ message: 'User not found' });

  if (user.paymentStatus !== 'paid') {
    return res.status(400).json({ message: 'Payment required before creating a team' });
  }

  if (user.teamId) {
    return res.status(400).json({ message: 'You are already in a team' });
  }

  const teamId = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + `-${Math.random().toString(36).substring(2, 6)}`;
  
  const origin = req.get('origin') || 'http://localhost:3000';
  const team = await Teams.create({
    id: teamId,
    name,
    description,
    college: user.college,
    logoUrl,
    leaderId: user.id,
    members: [user.id],
    remainingSlots: 3, // Team of max 4
    status: 'open',
    inviteLink: `${origin}/teams/join?teamId=${teamId}`,
    joinRequests: [],
    createdAt: new Date().toISOString()
  });

  await Users.updateOne(user.id, {
    role: 'team-leader',
    teamId: team.id,
    teamRole: 'leader'
  });

  const updatedUser = await Users.findOne({ id: user.id });
  return res.json({ success: true, team, user: updatedUser });
});

// 2. Request to Join a Team
router.post('/teams/join-request', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { teamId } = req.body;
  const userId = req.user?.id;

  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const user = await Users.findOne({ id: userId });
  if (!user) return res.status(404).json({ message: 'User not found' });

  if (user.paymentStatus !== 'paid') {
    return res.status(400).json({ message: 'Payment is required to join a team' });
  }

  if (user.teamId) {
    return res.status(400).json({ message: 'You are already in a team' });
  }

  const team = await Teams.findOne({ id: teamId });
  if (!team) return res.status(404).json({ message: 'Team not found' });

  if (team.status === 'full' || team.remainingSlots <= 0) {
    return res.status(400).json({ message: 'Team is already full' });
  }

  // Check if request already pending
  const alreadyRequested = team.joinRequests.some(r => r.userId === user.id && r.status === 'pending');
  if (alreadyRequested) {
    return res.status(400).json({ message: 'Join request is already pending' });
  }

  // Add join request
  const updatedRequests = [...team.joinRequests, {
    userId: user.id,
    name: user.name,
    email: user.email,
    college: user.college,
    status: 'pending' as const
  }];

  await Teams.updateOne(team.id, { joinRequests: updatedRequests });

  // Send notification to Team Leader
  await Notifications.create({
    recipientType: 'individual',
    recipientTarget: team.leaderId,
    title: 'New Join Request',
    message: `${user.name} wants to join your team "${team.name}".`,
    type: 'info',
    readBy: [],
    createdAt: new Date().toISOString()
  });

  // Send email to Team Leader
  try {
    const leader = await Users.findOne({ id: team.leaderId });
    if (leader) {
      const requestHtml = `
        <p>Hello <strong>${leader.name}</strong>,</p>
        <p>A participant has requested to join your team <strong>"${team.name}"</strong>:</p>
        
        <div class="ticket-card">
          <div class="ticket-header">JOIN REQUEST DETAILS</div>
          <div class="ticket-row">
            <span class="ticket-label">Name</span>
            <span class="ticket-value">${user.name}</span>
          </div>
          <div class="ticket-row">
            <span class="ticket-label">College</span>
            <span class="ticket-value">${user.college}</span>
          </div>
          <div class="ticket-row">
            <span class="ticket-label">Branch & Year</span>
            <span class="ticket-value">${user.branch} (${user.year})</span>
          </div>
          <div class="ticket-row">
            <span class="ticket-label">LinkedIn</span>
            <span class="ticket-value"><a href="${user.linkedin}" style="color: #a78bfa; text-decoration: none;">View LinkedIn</a></span>
          </div>
        </div>
        
        <p>Log in to your dashboard to approve or decline this join request.</p>
        
        <div class="cta-container">
          <a href="${req.get('origin') || 'http://localhost:3000'}/login" class="cta-button">Go to Dashboard</a>
        </div>
      `;
      const mailHtml = getEmailTemplate('New Join Request Received!', requestHtml);
      await sendEmail(leader.email, `DESIGNATHON 2026 - Join Request from ${user.name}`, mailHtml);
    }
  } catch (mailErr) {
    console.error('[Mail Error] Failed to send join request email to leader:', mailErr);
  }

  return res.json({ success: true, message: 'Request sent to team leader' });
});

// 3. Respond to Join Request (Accept / Reject)
router.post('/teams/respond-request', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { teamId, requestUserId, status } = req.body;
  const userId = req.user?.id;

  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const team = await Teams.findOne({ id: teamId });
  if (!team) return res.status(404).json({ message: 'Team not found' });

  if (team.leaderId !== userId) {
    return res.status(403).json({ message: 'Only the team leader can respond to requests' });
  }

  const request = team.joinRequests.find(r => r.userId === requestUserId && r.status === 'pending');
  if (!request) {
    return res.status(404).json({ message: 'Pending request not found' });
  }

  if (status === 'approved') {
    if (team.remainingSlots <= 0) {
      return res.status(400).json({ message: 'No slots available in your team' });
    }

    const memberUser = await Users.findOne({ id: requestUserId });
    if (!memberUser) return res.status(404).json({ message: 'Requesting user not found' });
    
    if (memberUser.teamId) {
      // Remove from requests, since they joined another team
      const updatedRequests = team.joinRequests.filter(r => r.userId !== requestUserId);
      await Teams.updateOne(team.id, { joinRequests: updatedRequests });
      return res.status(400).json({ message: 'User is already in another team' });
    }

    // Add to members
    const updatedMembers = [...team.members, requestUserId];
    const newSlots = Math.max(0, team.remainingSlots - 1);
    const teamStatus = newSlots === 0 ? 'full' as const : 'open' as const;

    // Filter out this pending request and update status
    const updatedRequests = team.joinRequests.map(r => 
      r.userId === requestUserId ? { ...r, status: 'approved' as const } : r
    );

    await Teams.updateOne(team.id, {
      members: updatedMembers,
      remainingSlots: newSlots,
      status: teamStatus,
      joinRequests: updatedRequests
    });

    // Update member profile
    await Users.updateOne(requestUserId, {
      teamId: team.id,
      teamRole: 'member'
    });

    // Notify applicant
    await Notifications.create({
      recipientType: 'individual',
      recipientTarget: requestUserId,
      title: 'Request Approved!',
      message: `Congratulations! You have been accepted into team "${team.name}".`,
      type: 'success',
      readBy: [],
      createdAt: new Date().toISOString()
    });

    // Notify applicant via email
    try {
      const applicant = await Users.findOne({ id: requestUserId });
      if (applicant) {
        const approvedHtml = `
          <p>Hello <strong>${applicant.name}</strong>,</p>
          <p>Congratulations! Your request to join team <strong>"${team.name}"</strong> has been <strong>approved</strong> by the team leader.</p>
          <p>You can now access your team management dashboard to invite other members, prepare your deliverables, and start planning.</p>
          
          <div class="cta-container">
            <a href="${req.get('origin') || 'http://localhost:3000'}/login" class="cta-button">Go to Dashboard</a>
          </div>
        `;
        const mailHtml = getEmailTemplate('Join Request Approved!', approvedHtml);
        await sendEmail(applicant.email, `DESIGNATHON 2026 - Join Request Approved for ${team.name}`, mailHtml);
      }
    } catch (mailErr) {
      console.error('[Mail Error] Failed to send approved email notification:', mailErr);
    }

  } else {
    // Reject
    const updatedRequests = team.joinRequests.map(r => 
      r.userId === requestUserId ? { ...r, status: 'rejected' as const } : r
    );

    await Teams.updateOne(team.id, { joinRequests: updatedRequests });

    // Notify applicant
    await Notifications.create({
      recipientType: 'individual',
      recipientTarget: requestUserId,
      title: 'Request Rejected',
      message: `Your request to join team "${team.name}" was declined.`,
      type: 'warning',
      readBy: [],
      createdAt: new Date().toISOString()
    });

    // Notify applicant via email
    try {
      const applicant = await Users.findOne({ id: requestUserId });
      if (applicant) {
        const rejectedHtml = `
          <p>Hello <strong>${applicant.name}</strong>,</p>
          <p>Your request to join team <strong>"${team.name}"</strong> was declined.</p>
          <p>Don't worry! You can browse other open teams looking for members, or create your own team and invite others.</p>
          
          <div class="cta-container">
            <a href="${req.get('origin') || 'http://localhost:3000'}/teams" class="cta-button">Browse Other Teams</a>
          </div>
        `;
        const mailHtml = getEmailTemplate('Join Request Update', rejectedHtml);
        await sendEmail(applicant.email, `DESIGNATHON 2026 - Join Request Update`, mailHtml);
      }
    } catch (mailErr) {
      console.error('[Mail Error] Failed to send rejected email notification:', mailErr);
    }
  }

  const updatedTeam = await Teams.findOne({ id: team.id });
  return res.json({ success: true, team: updatedTeam });
});

// 4. Remove Team Member / Leave Team
router.post('/teams/remove-member', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { teamId, targetUserId } = req.body;
  const userId = req.user?.id;

  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const team = await Teams.findOne({ id: teamId });
  if (!team) return res.status(404).json({ message: 'Team not found' });

  const isLeader = team.leaderId === userId;
  const isSelf = targetUserId === userId;

  if (!isLeader && !isSelf) {
    return res.status(403).json({ message: 'Unauthorized permission' });
  }

  if (isSelf && isLeader) {
    return res.status(400).json({ message: 'Leader cannot leave the team. Dissolve or transfer leadership instead.' });
  }

  // Remove member
  const updatedMembers = team.members.filter(m => m !== targetUserId);
  const newSlots = team.remainingSlots + 1;

  await Teams.updateOne(team.id, {
    members: updatedMembers,
    remainingSlots: newSlots,
    status: 'open'
  });

  // Reset target user's team details
  await Users.updateOne(targetUserId, {
    teamId: undefined,
    teamRole: undefined
  });

  // Notify member
  await Notifications.create({
    recipientType: 'individual',
    recipientTarget: targetUserId,
    title: 'Removed from Team',
    message: isSelf ? `You left the team "${team.name}".` : `You were removed from team "${team.name}".`,
    type: 'warning',
    readBy: [],
    createdAt: new Date().toISOString()
  });

  const updatedTeam = await Teams.findOne({ id: team.id });
  return res.json({ success: true, team: updatedTeam });
});

// 5. Get current user's team detail
router.get('/teams/my-team', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const user = await Users.findOne({ id: userId });
  if (!user || !user.teamId) {
    return res.json({ team: null });
  }

  const team = await Teams.findOne({ id: user.teamId });
  if (!team) return res.json({ team: null });

  // Fetch full details of each team member
  const fullMembers = await Promise.all(
    team.members.map(async (mId) => {
      const mUser = await Users.findOne({ id: mId });
      return {
        id: mId,
        name: mUser?.name || 'Unknown',
        email: mUser?.email || '',
        college: mUser?.college || '',
        phone: mUser?.phone || '',
        checkedIn: mUser?.checkedIn || false,
        paymentStatus: mUser?.paymentStatus || 'pending'
      };
    })
  );

  return res.json({
    ...team,
    members: fullMembers
  });
});


// --- ADMIN ENDPOINTS (ADMIN ROLE ONLY) ---

// 1. Get Live Admin stats
router.get('/admin/stats', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const allUsers = await Users.find();
  const allTeams = await Teams.find();
  const allPayments = await Payments.find();

  const realParticipants = allUsers.filter(isRealParticipant);
  const totalRegistrations = realParticipants.length;
  const paidParticipants = realParticipants.filter(u => u.paymentStatus === 'paid' || u.registrationStatus === 'CONFIRMED').length;
  const confirmedParticipants = paidParticipants;
  const detailsSubmittedCount = realParticipants.filter(u => u.registrationStatus === 'DETAILS_SUBMITTED' || (!u.registrationStatus && u.paymentStatus !== 'paid')).length;
  const pendingPayments = realParticipants.filter(u => u.registrationStatus === 'PAYMENT_PENDING' || (u.paymentStatus === 'pending' && u.registrationStatus !== 'DETAILS_SUBMITTED')).length;
  const failedPayments = realParticipants.filter(u => u.registrationStatus === 'PAYMENT_FAILED' || u.registrationStatus === 'CANCELLED' || u.paymentStatus === 'failed').length;
  const checkedInCount = realParticipants.filter(u => u.checkedIn).length;
  const totalTeams = allTeams.length;
  const availableSlots = Math.max(0, 200 - paidParticipants); // e.g. Limit 200 attendees
  
  // Calculate total revenue from real participant payments
  const totalRevenue = allPayments
    .filter(p => p.status === 'success' && !HIDDEN_TEST_EMAILS.includes((p.userEmail || '').toLowerCase()) && !HIDDEN_TEST_NAMES.includes((p.userName || '').toLowerCase()))
    .reduce((sum, p) => sum + p.amount, 0);

  // College count
  const collegesList = realParticipants.map(u => u.college).filter(Boolean);
  const collegeCounts: { [key: string]: number } = {};
  collegesList.forEach(c => {
    collegeCounts[c] = (collegeCounts[c] || 0) + 1;
  });

  const collegesParticipating = Object.keys(collegeCounts).length;

  // Chart data simulation (Group by date)
  const registrationsByDate: { [key: string]: number } = {};
  realParticipants.forEach(u => {
    const dateStr = u.createdAt ? u.createdAt.split('T')[0] : 'Unknown';
    registrationsByDate[dateStr] = (registrationsByDate[dateStr] || 0) + 1;
  });

  const liveRegistrationsGraph = Object.keys(registrationsByDate).map(date => ({
    date,
    count: registrationsByDate[date]
  })).sort((a, b) => a.date.localeCompare(b.date));

  return res.json({
    totalRegistrations,
    totalParticipants: totalRegistrations,
    paidParticipants,
    confirmedParticipants,
    detailsSubmittedCount,
    pendingPayments,
    paymentPendingCount: pendingPayments,
    failedPayments,
    paymentFailedCount: failedPayments,
    checkedInCount,
    totalTeams,
    availableSlots,
    totalRevenue,
    collegesParticipating,
    collegeDistribution: collegeCounts,
    liveRegistrationsGraph
  });
});

// 2. Get list of participants
router.get('/admin/participants', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const { search, filter } = req.query;
  let list = await Users.find(isRealParticipant);

  // Attach default registrationId & status if missing
  list = list.map(u => ({
    ...u,
    registrationId: u.registrationId || (u.role === 'admin' ? 'ADMIN' : `DT26-${u.id.substring(0, 6).toUpperCase()}`),
    registrationStatus: u.registrationStatus || (u.paymentStatus === 'paid' ? 'CONFIRMED' : 'DETAILS_SUBMITTED'),
    currentPhase: u.currentPhase || (u.paymentStatus === 'paid' ? 'CONFIRMATION' : 'REGISTRATION')
  }));

  if (search) {
    const term = String(search).toLowerCase();
    list = list.filter(u => 
      (u.name && u.name.toLowerCase().includes(term)) || 
      (u.email && u.email.toLowerCase().includes(term)) || 
      (u.college && u.college.toLowerCase().includes(term)) ||
      (u.phone && u.phone.includes(term)) ||
      (u.registrationId && u.registrationId.toLowerCase().includes(term))
    );
  }

  if (filter && filter !== 'all') {
    if (filter === 'paid' || filter === 'confirmed') {
      list = list.filter(u => u.paymentStatus === 'paid' || u.registrationStatus === 'CONFIRMED');
    } else if (filter === 'submitted' || filter === 'unpaid') {
      list = list.filter(u => u.paymentStatus !== 'paid' && u.registrationStatus !== 'CONFIRMED');
    } else if (filter === 'checkedin') {
      list = list.filter(u => u.checkedIn);
    } else if (filter === 'failed') {
      list = list.filter(u => u.registrationStatus === 'PAYMENT_FAILED' || u.registrationStatus === 'CANCELLED' || u.paymentStatus === 'failed');
    }
  }

  // Sort newest first by default
  list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  return res.json(list);
});

// 3. Mark manual check-in or Scan QR code verify
router.post('/admin/check-in', authenticateToken, requireFullAdmin, async (req: Request, res: Response) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ message: 'User ID is required' });

  const user = await Users.findOne({ id: userId });
  if (!user) return res.status(404).json({ message: 'User not found' });

  if (user.paymentStatus !== 'paid') {
    return res.status(400).json({ message: 'Cannot check-in. Payment is still pending.' });
  }

  await Users.updateOne(user.id, {
    checkedIn: true,
    checkInTime: new Date().toISOString()
  });

  const updatedUser = await Users.findOne({ id: user.id });
  return res.json({ success: true, message: `${user.name} checked in successfully.`, user: updatedUser });
});

// 4. Coupons listing (with usage count)
router.get('/admin/coupons', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const list = await Coupons.find();
  return res.json(list);
});

// 5. Create Coupon
router.post('/admin/coupons/create', authenticateToken, requireFullAdmin, async (req: Request, res: Response) => {
  const { code, discountType, discountValue, collegeName, usageLimit, expiryDate } = req.body;

  if (!code || !discountType || !discountValue || !usageLimit || !expiryDate) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  const existing = await Coupons.findOne({ code: code.toUpperCase() });
  if (existing) {
    return res.status(400).json({ message: 'Coupon with this code already exists' });
  }

  const newCoupon = await Coupons.create({
    code: code.toUpperCase(),
    discountType,
    discountValue: Number(discountValue),
    collegeName: collegeName || undefined,
    usageLimit: Number(usageLimit),
    usageCount: 0,
    expiryDate,
    isActive: true,
    createdAt: new Date().toISOString()
  });

  return res.json({ success: true, coupon: newCoupon });
});

// 6. Toggle Coupon Active Status
router.post('/admin/coupons/toggle', authenticateToken, requireFullAdmin, async (req: Request, res: Response) => {
  const { couponId } = req.body;
  if (!couponId) return res.status(400).json({ message: 'Coupon ID is required' });

  const coupon = await Coupons.findOne({ id: couponId });
  if (!coupon) return res.status(404).json({ message: 'Coupon not found' });

  await Coupons.updateOne(coupon.id, { isActive: !coupon.isActive });
  const updatedCoupon = await Coupons.findOne({ id: coupon.id });

  return res.json({ success: true, coupon: updatedCoupon });
});

// 7. Get all teams for administrative overview
router.get('/admin/teams', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const list = await Teams.find();
  const enhancedTeams = await Promise.all(list.map(async (t) => {
    const leader = await Users.findOne({ id: t.leaderId });
    return {
      ...t,
      leaderName: leader ? leader.name : 'Unknown',
      memberCount: t.members.length
    };
  }));
  return res.json(enhancedTeams);
});

// 8. Delete a Team
router.delete('/admin/teams/:id', authenticateToken, requireFullAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const team = await Teams.findOne({ id });
  if (!team) return res.status(404).json({ message: 'Team not found' });

  // Reset team parameters for all members
  await Promise.all(team.members.map(mId => 
    Users.updateOne(mId, { teamId: undefined, teamRole: undefined, role: 'participant' })
  ));

  await Teams.deleteOne(id);
  return res.json({ success: true, message: 'Team dissolved and members reset.' });
});

// 9. Merge two teams
router.post('/admin/teams/merge', authenticateToken, requireFullAdmin, async (req: Request, res: Response) => {
  const { teamAId, teamBId } = req.body;

  if (!teamAId || !teamBId) {
    return res.status(400).json({ message: 'Both Team IDs are required' });
  }

  const teamA = await Teams.findOne({ id: teamAId });
  const teamB = await Teams.findOne({ id: teamBId });

  if (!teamA || !teamB) {
    return res.status(404).json({ message: 'One or both teams not found' });
  }

  const combinedMembers = [...teamA.members, ...teamB.members];
  if (combinedMembers.length > 4) {
    return res.status(400).json({ message: `Merged team would have ${combinedMembers.length} members. Maximum allowed is 4.` });
  }

  // Merge team B into team A: update members and slots in Team A
  const newSlots = Math.max(0, 4 - combinedMembers.length);
  await Teams.updateOne(teamAId, {
    members: combinedMembers,
    remainingSlots: newSlots,
    status: newSlots === 0 ? 'full' : 'open'
  });

  // Re-map team B members to team A, set role as standard member
  await Promise.all(teamB.members.map(async (mId) => {
    await Users.updateOne(mId, {
      teamId: teamAId,
      teamRole: mId === teamA.leaderId ? 'leader' : 'member'
    });
  }));

  // Delete team B
  await Teams.deleteOne(teamBId);

  return res.json({ success: true, message: `Successfully merged team ${teamB.name} into ${teamA.name}` });
});

// 10. Send Broadcast Notification (SMS/Email simulation)
router.post('/admin/notifications/send', authenticateToken, requireFullAdmin, async (req: Request, res: Response) => {
  const { recipientType, recipientTarget, title, message, channel } = req.body; // channel: 'email' | 'sms' | 'push'

  if (!recipientType || !title || !message) {
    return res.status(400).json({ message: 'recipientType, title and message are required' });
  }

  // Save notification in database
  const notification = await Notifications.create({
    recipientType,
    recipientTarget: recipientTarget || undefined,
    title,
    message,
    type: 'info',
    readBy: [],
    createdAt: new Date().toISOString()
  });

  // Send email if channel is email or unspecified
  if (!channel || channel === 'email') {
    try {
      const allUsers = await Users.find();
      const targetUsers = allUsers.filter(u => {
        if (u.role === 'admin') return false; // Don't broadcast to admin
        if (recipientType === 'all') return true;
        if (recipientType === 'college' && recipientTarget && u.college.toLowerCase() === recipientTarget.toLowerCase()) return true;
        if (recipientType === 'team' && recipientTarget && u.teamId === recipientTarget) return true;
        if (recipientType === 'individual' && recipientTarget && u.id === recipientTarget) return true;
        return false;
      });

      // Send to all targets
      for (const u of targetUsers) {
        const broadcastHtml = `
          <p>Hello <strong>${u.name}</strong>,</p>
          <p>${message}</p>
        `;
        const mailHtml = getEmailTemplate(title, broadcastHtml);
        await sendEmail(u.email, title, mailHtml);
      }
    } catch (mailErr) {
      console.error('[Mail Error] Failed to send broadcast email:', mailErr);
    }
  }

  // Simulated email/sms sending logs
  console.log(`[BROADCAST via ${channel || 'email'}] Target: ${recipientType} (${recipientTarget || 'ALL'}). Message: ${message}`);

  return res.json({ success: true, message: `Broadcast successfully dispatched via ${channel || 'email'}!`, notification });
});

// 11. Export CSV Participants
router.get('/admin/export-csv', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const users = await Users.find(isRealParticipant);
  
  // Create CSV format
  const headers = 'ID,Name,Email,Phone,College,Branch,Year,PaymentStatus,AmountPaid,CheckedIn,RegistrationDate\n';
  const rows = users.map(u => 
    `"${u.id}","${u.name}","${u.email}","${u.phone}","${u.college}","${u.branch}","${u.year}","${u.paymentStatus}",${u.amountPaid},"${u.checkedIn ? 'Yes' : 'No'}","${u.createdAt}"`
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=participants.csv');
  return res.send(headers + rows);
});


// --- USER FEED NOTIFICATIONS ---

// 1. Get user notifications feed
router.get('/notifications', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const user = await Users.findOne({ id: userId });
  if (!user) return res.status(404).json({ message: 'User not found' });

  // Get notifications matching:
  // - type = 'all'
  // - type = 'college' AND target = user's college
  // - type = 'team' AND target = user's teamId
  // - type = 'individual' AND target = user's ID
  const allNotifications = await Notifications.find();
  const userNotifications = allNotifications.filter(n => {
    if (n.recipientType === 'all') return true;
    if (n.recipientType === 'college' && n.recipientTarget?.toLowerCase() === user.college.toLowerCase()) return true;
    if (n.recipientType === 'team' && user.teamId && n.recipientTarget === user.teamId) return true;
    if (n.recipientType === 'individual' && n.recipientTarget === user.id) return true;
    return false;
  });

  return res.json(userNotifications);
});

// 2. Mark notification as read
router.post('/notifications/read', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { notificationId } = req.body;
  const userId = req.user?.id;

  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const notification = await Notifications.findOne({ id: notificationId });
  if (!notification) return res.status(404).json({ message: 'Notification not found' });

  if (!notification.readBy.includes(userId)) {
    const updatedReadBy = [...notification.readBy, userId];
    await Notifications.updateOne(notification.id, { readBy: updatedReadBy });
  }

  return res.json({ success: true });
});

// --- TEAM INVITES ---

// 1. Leader sends invite to a user by email
router.post('/teams/invite', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const { inviteeEmail } = req.body;
  if (!inviteeEmail) return res.status(400).json({ message: 'Invitee email is required' });

  const leader = await Users.findOne({ id: userId });
  if (!leader) return res.status(404).json({ message: 'Leader not found' });
  if (!leader.teamId) return res.status(400).json({ message: 'You must have a team to send invites' });
  if (leader.teamRole !== 'leader') return res.status(403).json({ message: 'Only team leaders can send invites' });

  const team = await Teams.findOne({ id: leader.teamId });
  if (!team) return res.status(404).json({ message: 'Team not found' });
  if (team.remainingSlots <= 0) return res.status(400).json({ message: 'Team is already full' });

  // Check if invitee already in a team
  const invitee = await Users.findOne({ email: inviteeEmail.toLowerCase() });
  if (invitee?.teamId) return res.status(400).json({ message: 'This user is already in a team' });
  if (invitee?.paymentStatus !== 'paid') return res.status(400).json({ message: 'User must have completed payment before joining a team' });

  // Check duplicate pending invite
  const existing = await Invites.findOne((inv) => inv.teamId === team.id && inv.inviteeEmail === inviteeEmail.toLowerCase() && inv.status === 'pending');
  if (existing) return res.status(400).json({ message: 'An invite is already pending for this email' });

  const invite = await Invites.create({
    teamId: team.id,
    teamName: team.name,
    leaderId: userId,
    leaderName: leader.name,
    inviteeEmail: inviteeEmail.toLowerCase(),
    inviteeId: invitee?.id,
    status: 'pending',
    createdAt: new Date().toISOString()
  });

  // Send in-app notification if invitee already registered
  if (invitee) {
    await Notifications.create({
      recipientType: 'individual',
      recipientTarget: invitee.id,
      title: `Team Invite from ${leader.name}`,
      message: `You have been invited to join team "${team.name}". Log in to accept or decline.`,
      type: 'info',
      readBy: [],
      createdAt: new Date().toISOString()
    });
  }

  // Send email invitation
  try {
    const origin = req.get('origin') || 'http://localhost:3000';
    const inviteLink = `${origin}/teams/join?teamId=${team.id}`;
    const inviteHtml = `
      <p>Hello,</p>
      <p>You have been invited by <strong>${leader.name}</strong> to join their team <strong>"${team.name}"</strong> for <strong>DESIGNATHON 2026</strong>.</p>
      
      <div class="ticket-card" style="text-align: center; padding: 25px;">
        <h3 style="color: #ffffff; margin-top: 0;">TEAM INVITATION</h3>
        <p style="font-size: 13px; color: #a1a1aa; margin-bottom: 20px;">
          You're invited to join <strong>${team.name}</strong> (${team.college}) as a team member.
        </p>
        <a href="${inviteLink}" class="cta-button" style="display: inline-block;">Accept Invite & Join</a>
      </div>
      
      <p>Please note: every member must complete individual registration and payment before joining a team.</p>
    `;
    const mailHtml = getEmailTemplate('Team Invitation Received!', inviteHtml);
    await sendEmail(inviteeEmail.toLowerCase(), `DESIGNATHON 2026 - Team Invitation from ${leader.name}`, mailHtml);
  } catch (mailErr) {
    console.error('[Mail Error] Failed to send team invite email:', mailErr);
  }

  return res.json({ success: true, invite });
});

// 2. Get all pending invites for the logged-in user
router.get('/teams/my-invites', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const user = await Users.findOne({ id: userId });
  if (!user) return res.status(404).json({ message: 'User not found' });

  // Match by inviteeId or email
  const invites = await Invites.find(
    (inv) => (inv.inviteeId === userId || inv.inviteeEmail === user.email.toLowerCase()) && inv.status === 'pending'
  );

  return res.json(invites);
});

// 3. Accept or reject an invite
router.post('/teams/invite-respond', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const { inviteId, action } = req.body; // action: 'accept' | 'reject'
  if (!inviteId || !action) return res.status(400).json({ message: 'inviteId and action are required' });

  const user = await Users.findOne({ id: userId });
  if (!user) return res.status(404).json({ message: 'User not found' });

  const invite = await Invites.findOne({ id: inviteId });
  if (!invite) return res.status(404).json({ message: 'Invite not found' });
  if (invite.status !== 'pending') return res.status(400).json({ message: 'Invite is no longer pending' });
  if (invite.inviteeEmail !== user.email.toLowerCase() && invite.inviteeId !== userId) {
    return res.status(403).json({ message: 'This invite is not for you' });
  }

  if (action === 'reject') {
    await Invites.updateOne(inviteId, { status: 'rejected' });
    return res.json({ success: true, message: 'Invite declined.' });
  }

  // Accept: add user to team
  if (user.teamId) return res.status(400).json({ message: 'You are already in a team. Leave first.' });

  const team = await Teams.findOne({ id: invite.teamId });
  if (!team) return res.status(404).json({ message: 'Team no longer exists' });
  if (team.remainingSlots <= 0) return res.status(400).json({ message: 'Team is now full' });

  const updatedMembers = [...team.members, userId];
  const newSlots = Math.max(0, team.remainingSlots - 1);
  await Teams.updateOne(team.id, {
    members: updatedMembers,
    remainingSlots: newSlots,
    status: newSlots === 0 ? 'full' : 'open'
  });

  await Users.updateOne(userId, { teamId: team.id, teamRole: 'member' });
  await Invites.updateOne(inviteId, { status: 'accepted', inviteeId: userId });

  // Notify leader
  await Notifications.create({
    recipientType: 'individual',
    recipientTarget: invite.leaderId,
    title: `${user.name} joined your team!`,
    message: `${user.name} accepted your invite and joined team "${team.name}".`,
    type: 'success',
    readBy: [],
    createdAt: new Date().toISOString()
  });

  // Notify leader via email
  try {
    const leader = await Users.findOne({ id: invite.leaderId });
    if (leader) {
      const acceptHtml = `
        <p>Hello <strong>${leader.name}</strong>,</p>
        <p>Great news! <strong>${user.name}</strong> has accepted your invitation and joined your team <strong>"${team.name}"</strong>.</p>
        <p>You can view your updated team roster on your dashboard.</p>
        
        <div class="cta-container">
          <a href="${req.get('origin') || 'http://localhost:3000'}/login" class="cta-button">Go to Dashboard</a>
        </div>
      `;
      const mailHtml = getEmailTemplate('Invitation Accepted!', acceptHtml);
      await sendEmail(leader.email, `DESIGNATHON 2026 - ${user.name} joined your team`, mailHtml);
    }
  } catch (mailErr) {
    console.error('[Mail Error] Failed to send invite acceptance email to leader:', mailErr);
  }

  const updatedUser = await Users.findOne({ id: userId });
  return res.json({ success: true, message: 'You have joined the team!', user: updatedUser });
});

export default router;
