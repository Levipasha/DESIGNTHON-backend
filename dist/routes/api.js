"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdmin = exports.authenticateToken = void 0;
const express_1 = require("express");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const uuid_1 = require("uuid");
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../config/db");
const router = (0, express_1.Router)();
const JWT_SECRET = process.env.JWT_SECRET || 'designthon-secret-key-2026';
// Authentication Middleware
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ message: 'Authorization token required' });
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        let user;
        if (decoded.id === 'admin-local') {
            user = { id: 'admin-local', role: 'admin' };
        }
        else {
            user = await db_1.Users.findOne({ id: decoded.id });
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }
        }
        req.user = { id: user.id, role: user.role };
        next();
    }
    catch (error) {
        return res.status(403).json({ message: 'Invalid or expired token' });
    }
};
exports.authenticateToken = authenticateToken;
// Admin Middleware
const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
    }
    next();
};
exports.requireAdmin = requireAdmin;
// --- AUTHENTICATION ENDPOINTS ---
// 1. Send OTP (Simulated)
router.post('/auth/otp-send', async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ message: 'Email is required' });
    }
    // Simulated OTP: 123456 for ease of testing
    console.log(`[OTP] Sent verification code 123456 to ${email}`);
    return res.json({ message: 'Verification code sent. Use code: 123456 to login.' });
});
// 2. Verify OTP (Handles both Login & Signup)
router.post('/auth/otp-verify', async (req, res) => {
    const { email, code, name, phone, college, branch, year, gender, linkedin, portfolio } = req.body;
    if (!email || !code) {
        return res.status(400).json({ message: 'Email and OTP code are required' });
    }
    if (code !== '123456') {
        return res.status(400).json({ message: 'Invalid verification code' });
    }
    let user = await db_1.Users.findOne({ email });
    if (!user) {
        // If sign up details are missing, tell the frontend to collect them
        if (!name || !phone || !college || !branch || !year || !gender) {
            return res.status(202).json({
                newUser: true,
                message: 'New user: Please complete your registration details.'
            });
        }
        // Create User (Participant by default)
        user = await db_1.Users.create({
            name,
            email,
            phone,
            college,
            branch,
            year,
            gender,
            linkedin,
            portfolio,
            role: 'participant',
            paymentStatus: 'pending',
            amountPaid: 0,
            checkedIn: false,
            createdAt: new Date().toISOString()
        });
    }
    const token = jsonwebtoken_1.default.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token, user });
});
// 2.5. Admin Login (Password-only for local running)
router.post('/auth/admin-login', async (req, res) => {
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
        role: 'admin',
        paymentStatus: 'paid',
        checkedIn: true
    };
    const token = jsonwebtoken_1.default.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token, user });
});
// 3. Google Login — verify Firebase ID token
router.post('/auth/google-login', async (req, res) => {
    const { idToken } = req.body;
    if (!idToken) {
        return res.status(400).json({ message: 'Firebase ID token is required.' });
    }
    try {
        // Verify token with Google's Identity Toolkit API
        const firebaseApiKey = process.env.FIREBASE_API_KEY;
        const verifyRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken }),
        });
        if (!verifyRes.ok) {
            const errBody = await verifyRes.json();
            console.error('[Google Login] Token verification failed:', errBody);
            return res.status(401).json({ message: 'Invalid or expired Google token.' });
        }
        const verifyData = await verifyRes.json();
        const googleUser = verifyData?.users?.[0];
        if (!googleUser) {
            return res.status(401).json({ message: 'Could not retrieve Google user info.' });
        }
        const email = (googleUser.email || '').toLowerCase().trim();
        const name = googleUser.displayName || email.split('@')[0];
        // Check if user already exists in DB
        let user = await db_1.Users.findOne({ email });
        if (!user) {
            // New user — redirect to registration with prefilled info
            return res.status(202).json({
                newUser: true,
                email,
                name,
                message: 'Google login success: Please complete registration.',
            });
        }
        const token = jsonwebtoken_1.default.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ token, user });
    }
    catch (err) {
        console.error('[Google Login] Error:', err);
        return res.status(500).json({ message: 'Server error during Google authentication.' });
    }
});
// 4. Get Current User profile
router.get('/auth/me', exports.authenticateToken, async (req, res) => {
    if (!req.user)
        return res.status(401).json({ message: 'Unauthorized' });
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
    const user = await db_1.Users.findOne({ id: req.user.id });
    if (!user) {
        return res.status(404).json({ message: 'User not found' });
    }
    return res.json(user);
});
// --- PUBLIC TEAMS ENDPOINTS ---
// 1. Get List of Public Teams (Search, filter, sort)
router.get('/public/teams', async (req, res) => {
    const { search, college, slotsAvailable, sort } = req.query;
    let allTeams = await db_1.Teams.find();
    // Attach leader names to the response for display
    const teamsWithLeaderDetails = await Promise.all(allTeams.map(async (t) => {
        const leader = await db_1.Users.findOne({ id: t.leaderId });
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
        filtered = filtered.filter(t => t.name.toLowerCase().includes(term) ||
            t.description.toLowerCase().includes(term) ||
            t.leaderName.toLowerCase().includes(term));
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
    }
    else {
        // Default alphabetical
        filtered.sort((a, b) => a.name.localeCompare(b.name));
    }
    return res.json(filtered);
});
// 2. Get distinct college names that are participating
router.get('/public/colleges', async (req, res) => {
    const usersList = await db_1.Users.find();
    const collegesSet = new Set(usersList.map(u => u.college).filter(Boolean));
    return res.json(Array.from(collegesSet));
});
// --- COUPONS ---
// 1. Validate Coupon Code
router.post('/coupons/validate', async (req, res) => {
    const { code, college } = req.body;
    if (!code) {
        return res.status(400).json({ message: 'Coupon code is required' });
    }
    const coupon = await db_1.Coupons.findOne({ code: code.toUpperCase() });
    if (!coupon || !coupon.isActive) {
        return res.status(400).json({ valid: false, message: 'Invalid or inactive coupon code' });
    }
    if (new Date(coupon.expiryDate).getTime() < Date.now()) {
        return res.status(400).json({ valid: false, message: 'Coupon code has expired' });
    }
    if (coupon.usageCount >= coupon.usageLimit) {
        return res.status(400).json({ valid: false, message: 'Coupon limit reached' });
    }
    // College restriction check
    if (coupon.collegeName && college) {
        if (coupon.collegeName.toLowerCase() !== college.toLowerCase()) {
            return res.status(400).json({
                valid: false,
                message: `This coupon is only valid for students from ${coupon.collegeName}`
            });
        }
    }
    const basePrice = 1000;
    let discountAmount = 0;
    if (coupon.discountType === 'percentage') {
        discountAmount = (basePrice * coupon.discountValue) / 100;
    }
    else {
        discountAmount = coupon.discountValue;
    }
    const finalPrice = Math.max(0, basePrice - discountAmount);
    return res.json({
        valid: true,
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        discountAmount,
        finalPrice
    });
});
// --- PAYMENTS & REGISTRATION MOCKS ---
// 1. Create Order (Real Razorpay integration)
router.post('/payments/create-order', exports.authenticateToken, async (req, res) => {
    const { amount } = req.body;
    if (!amount)
        return res.status(400).json({ message: 'Amount is required' });
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
                amount: Math.round(amount * 100), // Razorpay works in paise
                currency: 'INR',
                receipt: `receipt_${(0, uuid_1.v4)().substring(0, 14)}`
            })
        });
        if (!response.ok) {
            const errorData = await response.json();
            console.error('Razorpay order creation error:', errorData);
            return res.status(500).json({ message: 'Failed to create order with Razorpay', error: errorData });
        }
        const order = await response.json();
        return res.json({
            id: order.id,
            currency: order.currency,
            amount: order.amount,
        });
    }
    catch (error) {
        console.error('Error creating Razorpay order:', error);
        return res.status(500).json({ message: 'Internal server error while creating payment order', error: error.message });
    }
});
// 2. Capture and Verify Payment (Real Razorpay Verification)
router.post('/payments/verify', exports.authenticateToken, async (req, res) => {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature, couponCode, amount } = req.body;
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
        return res.status(400).json({ message: 'Missing required Razorpay payment verification parameters' });
    }
    // Verify Razorpay signature
    const keySecret = process.env.key_secret;
    if (!keySecret) {
        return res.status(500).json({ message: 'Razorpay secret key is not configured on the backend' });
    }
    const generated_signature = crypto_1.default
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');
    if (generated_signature !== razorpay_signature) {
        return res.status(400).json({ message: 'Payment verification failed: Signature mismatch' });
    }
    // Update User Payment Status
    const user = await db_1.Users.findOne({ id: userId });
    if (!user)
        return res.status(404).json({ message: 'User not found' });
    // Log the payment
    const paymentLog = await db_1.Payments.create({
        razorpayPaymentId: razorpay_payment_id,
        razorpayOrderId: razorpay_order_id,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        amount: amount || 1000,
        status: 'success',
        couponUsed: couponCode,
        createdAt: new Date().toISOString()
    });
    // Increment coupon count if used
    if (couponCode) {
        const coupon = await db_1.Coupons.findOne({ code: couponCode.toUpperCase() });
        if (coupon) {
            await db_1.Coupons.updateOne(coupon.id, { usageCount: coupon.usageCount + 1 });
        }
    }
    // Update user profile
    await db_1.Users.updateOne(user.id, {
        paymentStatus: 'paid',
        paymentId: paymentLog.razorpayPaymentId,
        couponUsed: couponCode || undefined,
        amountPaid: amount || 1000
    });
    // Create real-time notification
    await db_1.Notifications.create({
        recipientType: 'individual',
        recipientTarget: user.id,
        title: 'Payment Successful',
        message: `Thank you, ${user.name}! Your payment of ₹${amount || 1000} has been processed successfully. You are now registered.`,
        type: 'success',
        readBy: [],
        createdAt: new Date().toISOString()
    });
    const updatedUser = await db_1.Users.findOne({ id: user.id });
    return res.json({ success: true, message: 'Payment completed successfully', user: updatedUser });
});
// --- TEAMS ENDPOINTS (AUTHENTICATED) ---
// 1. Create a Team
router.post('/teams/create', exports.authenticateToken, async (req, res) => {
    const { name, description, logoUrl } = req.body;
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    const user = await db_1.Users.findOne({ id: userId });
    if (!user)
        return res.status(404).json({ message: 'User not found' });
    if (user.paymentStatus !== 'paid') {
        return res.status(400).json({ message: 'Payment required before creating a team' });
    }
    if (user.teamId) {
        return res.status(400).json({ message: 'You are already in a team' });
    }
    const teamId = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + `-${Math.random().toString(36).substring(2, 6)}`;
    const team = await db_1.Teams.create({
        id: teamId,
        name,
        description,
        college: user.college,
        logoUrl,
        leaderId: user.id,
        members: [user.id],
        remainingSlots: 3, // Team of max 4
        status: 'open',
        inviteLink: `http://localhost:3000/teams/join?teamId=${teamId}`,
        joinRequests: [],
        createdAt: new Date().toISOString()
    });
    await db_1.Users.updateOne(user.id, {
        role: 'team-leader',
        teamId: team.id,
        teamRole: 'leader'
    });
    const updatedUser = await db_1.Users.findOne({ id: user.id });
    return res.json({ success: true, team, user: updatedUser });
});
// 2. Request to Join a Team
router.post('/teams/join-request', exports.authenticateToken, async (req, res) => {
    const { teamId } = req.body;
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    const user = await db_1.Users.findOne({ id: userId });
    if (!user)
        return res.status(404).json({ message: 'User not found' });
    if (user.paymentStatus !== 'paid') {
        return res.status(400).json({ message: 'Payment is required to join a team' });
    }
    if (user.teamId) {
        return res.status(400).json({ message: 'You are already in a team' });
    }
    const team = await db_1.Teams.findOne({ id: teamId });
    if (!team)
        return res.status(404).json({ message: 'Team not found' });
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
            status: 'pending'
        }];
    await db_1.Teams.updateOne(team.id, { joinRequests: updatedRequests });
    // Send notification to Team Leader
    await db_1.Notifications.create({
        recipientType: 'individual',
        recipientTarget: team.leaderId,
        title: 'New Join Request',
        message: `${user.name} wants to join your team "${team.name}".`,
        type: 'info',
        readBy: [],
        createdAt: new Date().toISOString()
    });
    return res.json({ success: true, message: 'Request sent to team leader' });
});
// 3. Respond to Join Request (Accept / Reject)
router.post('/teams/respond-request', exports.authenticateToken, async (req, res) => {
    const { teamId, requestUserId, status } = req.body;
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    const team = await db_1.Teams.findOne({ id: teamId });
    if (!team)
        return res.status(404).json({ message: 'Team not found' });
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
        const memberUser = await db_1.Users.findOne({ id: requestUserId });
        if (!memberUser)
            return res.status(404).json({ message: 'Requesting user not found' });
        if (memberUser.teamId) {
            // Remove from requests, since they joined another team
            const updatedRequests = team.joinRequests.filter(r => r.userId !== requestUserId);
            await db_1.Teams.updateOne(team.id, { joinRequests: updatedRequests });
            return res.status(400).json({ message: 'User is already in another team' });
        }
        // Add to members
        const updatedMembers = [...team.members, requestUserId];
        const newSlots = Math.max(0, team.remainingSlots - 1);
        const teamStatus = newSlots === 0 ? 'full' : 'open';
        // Filter out this pending request and update status
        const updatedRequests = team.joinRequests.map(r => r.userId === requestUserId ? { ...r, status: 'approved' } : r);
        await db_1.Teams.updateOne(team.id, {
            members: updatedMembers,
            remainingSlots: newSlots,
            status: teamStatus,
            joinRequests: updatedRequests
        });
        // Update member profile
        await db_1.Users.updateOne(requestUserId, {
            teamId: team.id,
            teamRole: 'member'
        });
        // Notify applicant
        await db_1.Notifications.create({
            recipientType: 'individual',
            recipientTarget: requestUserId,
            title: 'Request Approved!',
            message: `Congratulations! You have been accepted into team "${team.name}".`,
            type: 'success',
            readBy: [],
            createdAt: new Date().toISOString()
        });
    }
    else {
        // Reject
        const updatedRequests = team.joinRequests.map(r => r.userId === requestUserId ? { ...r, status: 'rejected' } : r);
        await db_1.Teams.updateOne(team.id, { joinRequests: updatedRequests });
        // Notify applicant
        await db_1.Notifications.create({
            recipientType: 'individual',
            recipientTarget: requestUserId,
            title: 'Request Rejected',
            message: `Your request to join team "${team.name}" was declined.`,
            type: 'warning',
            readBy: [],
            createdAt: new Date().toISOString()
        });
    }
    const updatedTeam = await db_1.Teams.findOne({ id: team.id });
    return res.json({ success: true, team: updatedTeam });
});
// 4. Remove Team Member / Leave Team
router.post('/teams/remove-member', exports.authenticateToken, async (req, res) => {
    const { teamId, targetUserId } = req.body;
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    const team = await db_1.Teams.findOne({ id: teamId });
    if (!team)
        return res.status(404).json({ message: 'Team not found' });
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
    await db_1.Teams.updateOne(team.id, {
        members: updatedMembers,
        remainingSlots: newSlots,
        status: 'open'
    });
    // Reset target user's team details
    await db_1.Users.updateOne(targetUserId, {
        teamId: undefined,
        teamRole: undefined
    });
    // Notify member
    await db_1.Notifications.create({
        recipientType: 'individual',
        recipientTarget: targetUserId,
        title: 'Removed from Team',
        message: isSelf ? `You left the team "${team.name}".` : `You were removed from team "${team.name}".`,
        type: 'warning',
        readBy: [],
        createdAt: new Date().toISOString()
    });
    const updatedTeam = await db_1.Teams.findOne({ id: team.id });
    return res.json({ success: true, team: updatedTeam });
});
// 5. Get current user's team detail
router.get('/teams/my-team', exports.authenticateToken, async (req, res) => {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    const user = await db_1.Users.findOne({ id: userId });
    if (!user || !user.teamId) {
        return res.json({ team: null });
    }
    const team = await db_1.Teams.findOne({ id: user.teamId });
    if (!team)
        return res.json({ team: null });
    // Fetch full details of each team member
    const fullMembers = await Promise.all(team.members.map(async (mId) => {
        const mUser = await db_1.Users.findOne({ id: mId });
        return {
            id: mId,
            name: mUser?.name || 'Unknown',
            email: mUser?.email || '',
            college: mUser?.college || '',
            phone: mUser?.phone || '',
            checkedIn: mUser?.checkedIn || false,
            paymentStatus: mUser?.paymentStatus || 'pending'
        };
    }));
    return res.json({
        ...team,
        members: fullMembers
    });
});
// --- ADMIN ENDPOINTS (ADMIN ROLE ONLY) ---
// 1. Get Live Admin stats
router.get('/admin/stats', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const allUsers = await db_1.Users.find();
    const allTeams = await db_1.Teams.find();
    const allPayments = await db_1.Payments.find();
    const totalRegistrations = allUsers.filter(u => u.role !== 'admin').length;
    const paidParticipants = allUsers.filter(u => u.paymentStatus === 'paid' && u.role !== 'admin').length;
    const pendingPayments = allUsers.filter(u => u.paymentStatus === 'pending' && u.role !== 'admin').length;
    const totalTeams = allTeams.length;
    const availableSlots = 200 - paidParticipants; // e.g. Limit 200 attendees
    // Calculate total revenue
    const totalRevenue = allPayments
        .filter(p => p.status === 'success')
        .reduce((sum, p) => sum + p.amount, 0);
    // College count
    const collegesList = allUsers.map(u => u.college).filter(Boolean);
    const collegeCounts = {};
    collegesList.forEach(c => {
        collegeCounts[c] = (collegeCounts[c] || 0) + 1;
    });
    const collegesParticipating = Object.keys(collegeCounts).length;
    // Chart data simulation (Group by date)
    const registrationsByDate = {};
    allUsers.forEach(u => {
        if (u.role === 'admin')
            return;
        const dateStr = u.createdAt ? u.createdAt.split('T')[0] : 'Unknown';
        registrationsByDate[dateStr] = (registrationsByDate[dateStr] || 0) + 1;
    });
    const liveRegistrationsGraph = Object.keys(registrationsByDate).map(date => ({
        date,
        count: registrationsByDate[date]
    })).sort((a, b) => a.date.localeCompare(b.date));
    return res.json({
        totalRegistrations,
        paidParticipants,
        pendingPayments,
        totalTeams,
        availableSlots,
        totalRevenue,
        collegesParticipating,
        collegeDistribution: collegeCounts,
        liveRegistrationsGraph
    });
});
// 2. Get list of participants
router.get('/admin/participants', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { search } = req.query;
    let list = await db_1.Users.find(u => u.role !== 'admin');
    if (search) {
        const term = String(search).toLowerCase();
        list = list.filter(u => u.name.toLowerCase().includes(term) ||
            u.email.toLowerCase().includes(term) ||
            u.college.toLowerCase().includes(term) ||
            u.phone.includes(term));
    }
    return res.json(list);
});
// 3. Mark manual check-in or Scan QR code verify
router.post('/admin/check-in', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { userId } = req.body;
    if (!userId)
        return res.status(400).json({ message: 'User ID is required' });
    const user = await db_1.Users.findOne({ id: userId });
    if (!user)
        return res.status(404).json({ message: 'User not found' });
    if (user.paymentStatus !== 'paid') {
        return res.status(400).json({ message: 'Cannot check-in. Payment is still pending.' });
    }
    await db_1.Users.updateOne(user.id, {
        checkedIn: true,
        checkInTime: new Date().toISOString()
    });
    const updatedUser = await db_1.Users.findOne({ id: user.id });
    return res.json({ success: true, message: `${user.name} checked in successfully.`, user: updatedUser });
});
// 4. Coupons listing (with usage count)
router.get('/admin/coupons', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const list = await db_1.Coupons.find();
    return res.json(list);
});
// 5. Create Coupon
router.post('/admin/coupons/create', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { code, discountType, discountValue, collegeName, usageLimit, expiryDate } = req.body;
    if (!code || !discountType || !discountValue || !usageLimit || !expiryDate) {
        return res.status(400).json({ message: 'All fields are required' });
    }
    const existing = await db_1.Coupons.findOne({ code: code.toUpperCase() });
    if (existing) {
        return res.status(400).json({ message: 'Coupon with this code already exists' });
    }
    const newCoupon = await db_1.Coupons.create({
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
router.post('/admin/coupons/toggle', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { couponId } = req.body;
    if (!couponId)
        return res.status(400).json({ message: 'Coupon ID is required' });
    const coupon = await db_1.Coupons.findOne({ id: couponId });
    if (!coupon)
        return res.status(404).json({ message: 'Coupon not found' });
    await db_1.Coupons.updateOne(coupon.id, { isActive: !coupon.isActive });
    const updatedCoupon = await db_1.Coupons.findOne({ id: coupon.id });
    return res.json({ success: true, coupon: updatedCoupon });
});
// 7. Get all teams for administrative overview
router.get('/admin/teams', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const list = await db_1.Teams.find();
    const enhancedTeams = await Promise.all(list.map(async (t) => {
        const leader = await db_1.Users.findOne({ id: t.leaderId });
        return {
            ...t,
            leaderName: leader ? leader.name : 'Unknown',
            memberCount: t.members.length
        };
    }));
    return res.json(enhancedTeams);
});
// 8. Delete a Team
router.delete('/admin/teams/:id', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { id } = req.params;
    const team = await db_1.Teams.findOne({ id });
    if (!team)
        return res.status(404).json({ message: 'Team not found' });
    // Reset team parameters for all members
    await Promise.all(team.members.map(mId => db_1.Users.updateOne(mId, { teamId: undefined, teamRole: undefined, role: 'participant' })));
    await db_1.Teams.deleteOne(id);
    return res.json({ success: true, message: 'Team dissolved and members reset.' });
});
// 9. Merge two teams
router.post('/admin/teams/merge', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { teamAId, teamBId } = req.body;
    if (!teamAId || !teamBId) {
        return res.status(400).json({ message: 'Both Team IDs are required' });
    }
    const teamA = await db_1.Teams.findOne({ id: teamAId });
    const teamB = await db_1.Teams.findOne({ id: teamBId });
    if (!teamA || !teamB) {
        return res.status(404).json({ message: 'One or both teams not found' });
    }
    const combinedMembers = [...teamA.members, ...teamB.members];
    if (combinedMembers.length > 4) {
        return res.status(400).json({ message: `Merged team would have ${combinedMembers.length} members. Maximum allowed is 4.` });
    }
    // Merge team B into team A: update members and slots in Team A
    const newSlots = Math.max(0, 4 - combinedMembers.length);
    await db_1.Teams.updateOne(teamAId, {
        members: combinedMembers,
        remainingSlots: newSlots,
        status: newSlots === 0 ? 'full' : 'open'
    });
    // Re-map team B members to team A, set role as standard member
    await Promise.all(teamB.members.map(async (mId) => {
        await db_1.Users.updateOne(mId, {
            teamId: teamAId,
            teamRole: mId === teamA.leaderId ? 'leader' : 'member'
        });
    }));
    // Delete team B
    await db_1.Teams.deleteOne(teamBId);
    return res.json({ success: true, message: `Successfully merged team ${teamB.name} into ${teamA.name}` });
});
// 10. Send Broadcast Notification (SMS/Email simulation)
router.post('/admin/notifications/send', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { recipientType, recipientTarget, title, message, channel } = req.body; // channel: 'email' | 'sms' | 'push'
    if (!recipientType || !title || !message) {
        return res.status(400).json({ message: 'recipientType, title and message are required' });
    }
    // Save notification in database
    const notification = await db_1.Notifications.create({
        recipientType,
        recipientTarget: recipientTarget || undefined,
        title,
        message,
        type: 'info',
        readBy: [],
        createdAt: new Date().toISOString()
    });
    // Simulated email/sms sending logs
    console.log(`[BROADCAST via ${channel || 'email'}] Target: ${recipientType} (${recipientTarget || 'ALL'}). Message: ${message}`);
    return res.json({ success: true, message: `Broadcast successfully dispatched via ${channel || 'email'}!`, notification });
});
// 11. Export CSV Participants
router.get('/admin/export-csv', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const users = await db_1.Users.find(u => u.role !== 'admin');
    // Create CSV format
    const headers = 'ID,Name,Email,Phone,College,Branch,Year,PaymentStatus,AmountPaid,CheckedIn,RegistrationDate\n';
    const rows = users.map(u => `"${u.id}","${u.name}","${u.email}","${u.phone}","${u.college}","${u.branch}","${u.year}","${u.paymentStatus}",${u.amountPaid},"${u.checkedIn ? 'Yes' : 'No'}","${u.createdAt}"`).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=participants.csv');
    return res.send(headers + rows);
});
// --- USER FEED NOTIFICATIONS ---
// 1. Get user notifications feed
router.get('/notifications', exports.authenticateToken, async (req, res) => {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    const user = await db_1.Users.findOne({ id: userId });
    if (!user)
        return res.status(404).json({ message: 'User not found' });
    // Get notifications matching:
    // - type = 'all'
    // - type = 'college' AND target = user's college
    // - type = 'team' AND target = user's teamId
    // - type = 'individual' AND target = user's ID
    const allNotifications = await db_1.Notifications.find();
    const userNotifications = allNotifications.filter(n => {
        if (n.recipientType === 'all')
            return true;
        if (n.recipientType === 'college' && n.recipientTarget?.toLowerCase() === user.college.toLowerCase())
            return true;
        if (n.recipientType === 'team' && user.teamId && n.recipientTarget === user.teamId)
            return true;
        if (n.recipientType === 'individual' && n.recipientTarget === user.id)
            return true;
        return false;
    });
    return res.json(userNotifications);
});
// 2. Mark notification as read
router.post('/notifications/read', exports.authenticateToken, async (req, res) => {
    const { notificationId } = req.body;
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    const notification = await db_1.Notifications.findOne({ id: notificationId });
    if (!notification)
        return res.status(404).json({ message: 'Notification not found' });
    if (!notification.readBy.includes(userId)) {
        const updatedReadBy = [...notification.readBy, userId];
        await db_1.Notifications.updateOne(notification.id, { readBy: updatedReadBy });
    }
    return res.json({ success: true });
});
// --- TEAM INVITES ---
// 1. Leader sends invite to a user by email
router.post('/teams/invite', exports.authenticateToken, async (req, res) => {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    const { inviteeEmail } = req.body;
    if (!inviteeEmail)
        return res.status(400).json({ message: 'Invitee email is required' });
    const leader = await db_1.Users.findOne({ id: userId });
    if (!leader)
        return res.status(404).json({ message: 'Leader not found' });
    if (!leader.teamId)
        return res.status(400).json({ message: 'You must have a team to send invites' });
    if (leader.teamRole !== 'leader')
        return res.status(403).json({ message: 'Only team leaders can send invites' });
    const team = await db_1.Teams.findOne({ id: leader.teamId });
    if (!team)
        return res.status(404).json({ message: 'Team not found' });
    if (team.remainingSlots <= 0)
        return res.status(400).json({ message: 'Team is already full' });
    // Check if invitee already in a team
    const invitee = await db_1.Users.findOne({ email: inviteeEmail.toLowerCase() });
    if (invitee?.teamId)
        return res.status(400).json({ message: 'This user is already in a team' });
    if (invitee?.paymentStatus !== 'paid')
        return res.status(400).json({ message: 'User must have completed payment before joining a team' });
    // Check duplicate pending invite
    const existing = await db_1.Invites.findOne((inv) => inv.teamId === team.id && inv.inviteeEmail === inviteeEmail.toLowerCase() && inv.status === 'pending');
    if (existing)
        return res.status(400).json({ message: 'An invite is already pending for this email' });
    const invite = await db_1.Invites.create({
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
        await db_1.Notifications.create({
            recipientType: 'individual',
            recipientTarget: invitee.id,
            title: `Team Invite from ${leader.name}`,
            message: `You have been invited to join team "${team.name}". Log in to accept or decline.`,
            type: 'info',
            readBy: [],
            createdAt: new Date().toISOString()
        });
    }
    return res.json({ success: true, invite });
});
// 2. Get all pending invites for the logged-in user
router.get('/teams/my-invites', exports.authenticateToken, async (req, res) => {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    const user = await db_1.Users.findOne({ id: userId });
    if (!user)
        return res.status(404).json({ message: 'User not found' });
    // Match by inviteeId or email
    const invites = await db_1.Invites.find((inv) => (inv.inviteeId === userId || inv.inviteeEmail === user.email.toLowerCase()) && inv.status === 'pending');
    return res.json(invites);
});
// 3. Accept or reject an invite
router.post('/teams/invite-respond', exports.authenticateToken, async (req, res) => {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    const { inviteId, action } = req.body; // action: 'accept' | 'reject'
    if (!inviteId || !action)
        return res.status(400).json({ message: 'inviteId and action are required' });
    const user = await db_1.Users.findOne({ id: userId });
    if (!user)
        return res.status(404).json({ message: 'User not found' });
    const invite = await db_1.Invites.findOne({ id: inviteId });
    if (!invite)
        return res.status(404).json({ message: 'Invite not found' });
    if (invite.status !== 'pending')
        return res.status(400).json({ message: 'Invite is no longer pending' });
    if (invite.inviteeEmail !== user.email.toLowerCase() && invite.inviteeId !== userId) {
        return res.status(403).json({ message: 'This invite is not for you' });
    }
    if (action === 'reject') {
        await db_1.Invites.updateOne(inviteId, { status: 'rejected' });
        return res.json({ success: true, message: 'Invite declined.' });
    }
    // Accept: add user to team
    if (user.teamId)
        return res.status(400).json({ message: 'You are already in a team. Leave first.' });
    const team = await db_1.Teams.findOne({ id: invite.teamId });
    if (!team)
        return res.status(404).json({ message: 'Team no longer exists' });
    if (team.remainingSlots <= 0)
        return res.status(400).json({ message: 'Team is now full' });
    const updatedMembers = [...team.members, userId];
    const newSlots = Math.max(0, team.remainingSlots - 1);
    await db_1.Teams.updateOne(team.id, {
        members: updatedMembers,
        remainingSlots: newSlots,
        status: newSlots === 0 ? 'full' : 'open'
    });
    await db_1.Users.updateOne(userId, { teamId: team.id, teamRole: 'member' });
    await db_1.Invites.updateOne(inviteId, { status: 'accepted', inviteeId: userId });
    // Notify leader
    await db_1.Notifications.create({
        recipientType: 'individual',
        recipientTarget: invite.leaderId,
        title: `${user.name} joined your team!`,
        message: `${user.name} accepted your invite and joined team "${team.name}".`,
        type: 'success',
        readBy: [],
        createdAt: new Date().toISOString()
    });
    const updatedUser = await db_1.Users.findOne({ id: userId });
    return res.json({ success: true, message: 'You have joined the team!', user: updatedUser });
});
exports.default = router;
