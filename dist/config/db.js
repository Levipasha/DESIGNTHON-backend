"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Invites = exports.Payments = exports.Notifications = exports.Coupons = exports.Teams = exports.Users = exports.MongoCollection = void 0;
exports.connectDatabase = connectDatabase;
exports.seedDatabase = seedDatabase;
const mongoose_1 = __importDefault(require("mongoose"));
// ─── Shared Schema Options ────────────────────────────────────────────────────
const baseOpts = { strict: false };
// ─── Raw Mongoose Models (using Schema.Types.Mixed to avoid deep generics) ───
function makeModel(name) {
    if (mongoose_1.default.models[name])
        return mongoose_1.default.models[name];
    const s = new mongoose_1.default.Schema({ id: { type: String, required: true, unique: true } }, { ...baseOpts });
    return mongoose_1.default.model(name, s);
}
const UserModel = makeModel('User');
const TeamModel = makeModel('Team');
const CouponModel = makeModel('Coupon');
const NotifModel = makeModel('Notification');
const PaymentModel = makeModel('Payment');
const InviteModel = makeModel('Invite');
// ─── Generic Collection Wrapper ───────────────────────────────────────────────
class MongoCollection {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(model) {
        this.model = model;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toPlain(doc) {
        if (!doc)
            return doc;
        const obj = doc.toObject ? doc.toObject({ versionKey: false }) : { ...doc };
        delete obj._id;
        delete obj.__v;
        return obj;
    }
    async find(filter) {
        if (!filter) {
            return (await this.model.find({})).map((d) => this.toPlain(d));
        }
        if (typeof filter === 'function') {
            const all = (await this.model.find({})).map((d) => this.toPlain(d));
            return all.filter(filter);
        }
        return (await this.model.find(filter)).map((d) => this.toPlain(d));
    }
    async findOne(filter) {
        if (typeof filter === 'function') {
            const all = (await this.model.find({})).map((d) => this.toPlain(d));
            return all.find(filter) || null;
        }
        const doc = await this.model.findOne(filter);
        return doc ? this.toPlain(doc) : null;
    }
    async create(item) {
        const id = item.id || new mongoose_1.default.Types.ObjectId().toHexString();
        const doc = await this.model.create({ ...item, id });
        return this.toPlain(doc);
    }
    async updateOne(id, update) {
        const doc = await this.model.findOneAndUpdate({ id }, { $set: update }, { new: true });
        return doc ? this.toPlain(doc) : null;
    }
    async deleteOne(id) {
        const result = await this.model.deleteOne({ id });
        return result.deletedCount > 0;
    }
    async count(filter) {
        return (await this.find(filter)).length;
    }
}
exports.MongoCollection = MongoCollection;
// ─── Exports ──────────────────────────────────────────────────────────────────
exports.Users = new MongoCollection(UserModel);
exports.Teams = new MongoCollection(TeamModel);
exports.Coupons = new MongoCollection(CouponModel);
exports.Notifications = new MongoCollection(NotifModel);
exports.Payments = new MongoCollection(PaymentModel);
exports.Invites = new MongoCollection(InviteModel);
// ─── MongoDB Connection ───────────────────────────────────────────────────────
async function connectDatabase() {
    const uri = process.env.MONGODB_URI;
    if (!uri)
        throw new Error('MONGODB_URI is not set in .env');
    await mongoose_1.default.connect(uri);
    console.log('[DB] Connected to MongoDB Atlas successfully.');
}
// ─── Seed Database ────────────────────────────────────────────────────────────
async function seedDatabase() {
    const adminExists = await exports.Users.findOne({ email: 'admin@designthon.com' });
    if (!adminExists) {
        await exports.Users.create({
            name: 'Designthon Admin', email: 'admin@designthon.com', phone: '9999999999',
            college: 'DESIGNTHON Core', branch: 'Administration', year: 'N/A', gender: 'Other',
            linkedin: 'https://linkedin.com', role: 'admin', paymentStatus: 'paid',
            amountPaid: 0, checkedIn: false, createdAt: new Date().toISOString()
        });
        console.log('[DB] Admin user seeded.');
    }
    const couponsCount = await exports.Coupons.count();
    if (couponsCount === 0) {
        const now = new Date().toISOString();
        await exports.Coupons.create({ code: 'JNTUH50', discountType: 'percentage', discountValue: 50, collegeName: 'JNTUH', usageLimit: 50, usageCount: 0, expiryDate: '2026-12-31', isActive: true, createdAt: now });
        await exports.Coupons.create({ code: 'VNR20', discountType: 'percentage', discountValue: 20, usageLimit: 100, usageCount: 0, expiryDate: '2026-12-31', isActive: true, createdAt: now });
        await exports.Coupons.create({ code: 'MGIT100', discountType: 'percentage', discountValue: 100, collegeName: 'MGIT', usageLimit: 10, usageCount: 0, expiryDate: '2026-12-31', isActive: true, createdAt: now });
        console.log('[DB] Coupons seeded.');
    }
    const teamsCount = await exports.Teams.count();
    if (teamsCount === 0) {
        const now = new Date().toISOString();
        const leader1 = await exports.Users.create({ name: 'Rohit Sharma', email: 'rohit@vnr.edu', phone: '8888888888', college: 'VNR Vignana Jyothi', branch: 'CSE', year: '3rd Year', gender: 'Male', linkedin: 'https://linkedin.com', role: 'team-leader', paymentStatus: 'paid', amountPaid: 800, checkedIn: true, createdAt: now });
        const team1 = await exports.Teams.create({ name: 'Figma Wizards', description: 'Creating minimalist Figma designs with micro-interactions.', college: 'VNR Vignana Jyothi', leaderId: leader1.id, members: [leader1.id], remainingSlots: 3, status: 'open', inviteLink: 'http://localhost:3000/teams/join?teamId=figma-wizards', joinRequests: [], createdAt: now });
        await exports.Users.updateOne(leader1.id, { teamId: team1.id, teamRole: 'leader' });
        const leader2 = await exports.Users.create({ name: 'Aditi Rao', email: 'aditi@jntuh.ac.in', phone: '7777777777', college: 'JNTUH', branch: 'IT', year: '4th Year', gender: 'Female', linkedin: 'https://linkedin.com', role: 'team-leader', paymentStatus: 'paid', amountPaid: 500, checkedIn: false, createdAt: now });
        const member2 = await exports.Users.create({ name: 'Karthik S', email: 'karthik@jntuh.ac.in', phone: '7777777778', college: 'JNTUH', branch: 'ECE', year: '4th Year', gender: 'Male', linkedin: 'https://linkedin.com', role: 'participant', paymentStatus: 'paid', amountPaid: 500, checkedIn: false, createdAt: now });
        const team2 = await exports.Teams.create({ name: 'Pixel Perfect', description: 'Design components modeled after linear.app and Apple interfaces.', college: 'JNTUH', leaderId: leader2.id, members: [leader2.id, member2.id], remainingSlots: 2, status: 'open', inviteLink: 'http://localhost:3000/teams/join?teamId=pixel-perfect', joinRequests: [], createdAt: now });
        await exports.Users.updateOne(leader2.id, { teamId: team2.id, teamRole: 'leader' });
        await exports.Users.updateOne(member2.id, { teamId: team2.id, teamRole: 'member' });
        console.log('[DB] Mock teams seeded.');
    }
}
