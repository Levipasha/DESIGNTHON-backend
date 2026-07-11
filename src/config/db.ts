import mongoose from 'mongoose';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  college: string;
  branch: string;
  year: string;
  gender: string;
  linkedin: string;
  portfolio?: string;
  role: 'admin' | 'team-leader' | 'participant';
  paymentStatus: 'pending' | 'paid' | 'refunded';
  paymentId?: string;
  couponUsed?: string;
  amountPaid: number;
  teamId?: string;
  teamRole?: 'leader' | 'member';
  checkedIn: boolean;
  checkInTime?: string;
  createdAt: string;
}

export interface Team {
  id: string;
  name: string;
  description: string;
  college: string;
  logoUrl?: string;
  leaderId: string;
  members: string[];
  remainingSlots: number;
  status: 'open' | 'full';
  inviteLink: string;
  qrCodeDataUrl?: string;
  joinRequests: { userId: string; name: string; email: string; college: string; status: 'pending' | 'approved' | 'rejected' }[];
  createdAt: string;
}

export interface Coupon {
  id: string;
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  collegeName?: string;
  usageLimit: number;
  usageCount: number;
  expiryDate: string;
  isActive: boolean;
  createdAt: string;
}

export interface Notification {
  id: string;
  recipientType: 'all' | 'college' | 'team' | 'individual';
  recipientTarget?: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning';
  readBy: string[];
  createdAt: string;
}

export interface PaymentLog {
  id: string;
  razorpayPaymentId: string;
  razorpayOrderId: string;
  userId: string;
  userName: string;
  userEmail: string;
  amount: number;
  status: 'success' | 'failed' | 'refunded';
  couponUsed?: string;
  createdAt: string;
}

export interface TeamInvite {
  id: string;
  teamId: string;
  teamName: string;
  leaderId: string;
  leaderName: string;
  inviteeEmail: string;
  inviteeId?: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

// ─── Shared Schema Options ────────────────────────────────────────────────────

const baseOpts = { strict: false };

// ─── Raw Mongoose Models (using Schema.Types.Mixed to avoid deep generics) ───

function makeModel(name: string) {
  if (mongoose.models[name]) return mongoose.models[name];
  const s = new mongoose.Schema({ id: { type: String, required: true, unique: true } }, { ...baseOpts });
  return mongoose.model(name, s);
}

const UserModel       = makeModel('User');
const TeamModel       = makeModel('Team');
const CouponModel     = makeModel('Coupon');
const NotifModel      = makeModel('Notification');
const PaymentModel    = makeModel('Payment');
const InviteModel     = makeModel('Invite');

// ─── Generic Collection Wrapper ───────────────────────────────────────────────

export class MongoCollection<T extends { id: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private model: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(model: any) {
    this.model = model;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toPlain(doc: any): T {
    if (!doc) return doc;
    const obj = doc.toObject ? doc.toObject({ versionKey: false }) : { ...doc };
    delete obj._id;
    delete obj.__v;
    return obj as T;
  }

  async find(filter?: Partial<T> | ((item: T) => boolean)): Promise<T[]> {
    if (!filter) {
      return (await this.model.find({})).map((d: any) => this.toPlain(d));
    }
    if (typeof filter === 'function') {
      const all: T[] = (await this.model.find({})).map((d: any) => this.toPlain(d));
      return all.filter(filter);
    }
    return (await this.model.find(filter)).map((d: any) => this.toPlain(d));
  }

  async findOne(filter: Partial<T> | ((item: T) => boolean)): Promise<T | null> {
    if (typeof filter === 'function') {
      const all: T[] = (await this.model.find({})).map((d: any) => this.toPlain(d));
      return all.find(filter) || null;
    }
    const doc = await this.model.findOne(filter);
    return doc ? this.toPlain(doc) : null;
  }

  async create(item: Omit<T, 'id'> & { id?: string }): Promise<T> {
    const id = (item as any).id || new mongoose.Types.ObjectId().toHexString();
    const doc = await this.model.create({ ...item, id });
    return this.toPlain(doc);
  }

  async updateOne(id: string, update: Partial<T>): Promise<T | null> {
    const doc = await this.model.findOneAndUpdate({ id }, { $set: update }, { new: true });
    return doc ? this.toPlain(doc) : null;
  }

  async deleteOne(id: string): Promise<boolean> {
    const result = await this.model.deleteOne({ id });
    return (result as any).deletedCount > 0;
  }

  async count(filter?: Partial<T> | ((item: T) => boolean)): Promise<number> {
    return (await this.find(filter)).length;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const Users         = new MongoCollection<User>(UserModel);
export const Teams         = new MongoCollection<Team>(TeamModel);
export const Coupons       = new MongoCollection<Coupon>(CouponModel);
export const Notifications = new MongoCollection<Notification>(NotifModel);
export const Payments      = new MongoCollection<PaymentLog>(PaymentModel);
export const Invites       = new MongoCollection<TeamInvite>(InviteModel);

// ─── MongoDB Connection ───────────────────────────────────────────────────────

export async function connectDatabase(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set in .env');
  await mongoose.connect(uri);
  console.log('[DB] Connected to MongoDB Atlas successfully.');
}

// ─── Seed Database ────────────────────────────────────────────────────────────

export async function seedDatabase() {
  const adminExists = await Users.findOne({ email: 'admin@designthon.com' } as any);
  if (!adminExists) {
    await Users.create({
      name: 'Designthon Admin', email: 'admin@designthon.com', phone: '9999999999',
      college: 'DESIGNTHON Core', branch: 'Administration', year: 'N/A', gender: 'Other',
      linkedin: 'https://linkedin.com', role: 'admin', paymentStatus: 'paid',
      amountPaid: 0, checkedIn: false, createdAt: new Date().toISOString()
    });
    console.log('[DB] Admin user seeded.');
  }

  const couponsCount = await Coupons.count();
  if (couponsCount === 0) {
    const now = new Date().toISOString();
    await Coupons.create({ code: 'JNTUH50', discountType: 'percentage', discountValue: 50, collegeName: 'JNTUH', usageLimit: 50, usageCount: 0, expiryDate: '2026-12-31', isActive: true, createdAt: now });
    await Coupons.create({ code: 'VNR20',   discountType: 'percentage', discountValue: 20, usageLimit: 100, usageCount: 0, expiryDate: '2026-12-31', isActive: true, createdAt: now });
    await Coupons.create({ code: 'MGIT100', discountType: 'percentage', discountValue: 100, collegeName: 'MGIT', usageLimit: 10, usageCount: 0, expiryDate: '2026-12-31', isActive: true, createdAt: now });
    console.log('[DB] Coupons seeded.');
  }

  const teamsCount = await Teams.count();
  if (teamsCount === 0) {
    const now = new Date().toISOString();
    const leader1 = await Users.create({ name: 'Rohit Sharma', email: 'rohit@vnr.edu', phone: '8888888888', college: 'VNR Vignana Jyothi', branch: 'CSE', year: '3rd Year', gender: 'Male', linkedin: 'https://linkedin.com', role: 'team-leader', paymentStatus: 'paid', amountPaid: 800, checkedIn: true, createdAt: now });
    const team1  = await Teams.create({ name: 'Figma Wizards', description: 'Creating minimalist Figma designs with micro-interactions.', college: 'VNR Vignana Jyothi', leaderId: leader1.id, members: [leader1.id], remainingSlots: 3, status: 'open', inviteLink: 'http://localhost:3000/teams/join?teamId=figma-wizards', joinRequests: [], createdAt: now });
    await Users.updateOne(leader1.id, { teamId: team1.id, teamRole: 'leader' });

    const leader2 = await Users.create({ name: 'Aditi Rao', email: 'aditi@jntuh.ac.in', phone: '7777777777', college: 'JNTUH', branch: 'IT', year: '4th Year', gender: 'Female', linkedin: 'https://linkedin.com', role: 'team-leader', paymentStatus: 'paid', amountPaid: 500, checkedIn: false, createdAt: now });
    const member2 = await Users.create({ name: 'Karthik S', email: 'karthik@jntuh.ac.in', phone: '7777777778', college: 'JNTUH', branch: 'ECE', year: '4th Year', gender: 'Male', linkedin: 'https://linkedin.com', role: 'participant', paymentStatus: 'paid', amountPaid: 500, checkedIn: false, createdAt: now });
    const team2  = await Teams.create({ name: 'Pixel Perfect', description: 'Design components modeled after linear.app and Apple interfaces.', college: 'JNTUH', leaderId: leader2.id, members: [leader2.id, member2.id], remainingSlots: 2, status: 'open', inviteLink: 'http://localhost:3000/teams/join?teamId=pixel-perfect', joinRequests: [], createdAt: now });
    await Users.updateOne(leader2.id, { teamId: team2.id, teamRole: 'leader' });
    await Users.updateOne(member2.id, { teamId: team2.id, teamRole: 'member' });
    console.log('[DB] Mock teams seeded.');
  }
}
