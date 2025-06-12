"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
const cors_1 = __importDefault(require("cors"));
const prisma_1 = require("../src/generated/prisma");
const bcrypt_1 = __importDefault(require("bcrypt"));
const resend_1 = require("resend");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const resend = new resend_1.Resend(process.env.RESEND_API_KEY);
// Updated Prisma client instantiation for serverless environment
let prisma;
if (process.env.NODE_ENV === "production") {
    prisma = new prisma_1.PrismaClient();
}
else {
    // Prevent multiple instances during development/hot reloading
    if (!global.prisma) {
        global.prisma = new prisma_1.PrismaClient();
    }
    prisma = global.prisma;
}
const hashSalt = 10;
// @ts-ignore
app.post("/signup", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { username, email, password } = req.body;
        if (!username || !password) {
            return res.status(400).send("Username and password are required");
        }
        const existingUser = yield prisma.admin.findUnique({
            where: { username },
        });
        if (existingUser) {
            return res.status(400).send("User already exists");
        }
        const hashedPassword = yield bcrypt_1.default.hash(password, hashSalt);
        const user = yield prisma.admin.create({
            data: {
                username,
                email,
                password: hashedPassword
            },
        });
        res.status(201).json({ userId: user.id });
    }
    catch (error) {
        console.error("Error signing up:", error);
        res.status(500).send("Error signing up");
    }
}));
// @ts-ignore
app.post("/login", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).send("Username and password are required");
        }
        const user = yield prisma.admin.findUnique({
            where: { username },
        });
        if (!user) {
            return res.status(404).send("User not found");
        }
        const isPasswordValid = yield bcrypt_1.default.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).send("Invalid password");
        }
        res.status(200).json({ userId: user.id });
    }
    catch (error) {
        console.error("Error logging in:", error);
        res.status(500).send("Error logging in");
    }
}));
// @ts-ignore
app.get("/total-subscribers", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const totalSubscribers = yield prisma.email.count();
        res.status(200).json({ totalSubscribers });
    }
    catch (error) {
        console.error("Error fetching total subscribers:", error);
        res.status(500).send("Error fetching total subscribers");
    }
}));
// @ts-ignore
app.get("/total-emails", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userId } = req.query;
        if (!userId) {
            return res.status(400).send("User ID is required");
        }
        const admin = yield prisma.admin.findUnique({
            where: { id: userId }
        });
        if (!admin) {
            return res.status(404).send("Admin not found");
        }
        const totalEmails = admin.emailSent;
        res.status(200).json({ totalEmails });
    }
    catch (error) {
        console.error("Error fetching total emails:", error);
        res.status(500).send("Error fetching total emails");
    }
}));
// @ts-ignore
app.post("/send-email", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userId, subject, body } = req.body;
        if (!userId || !subject || !body) {
            return res.status(400).send("User ID, subject, and body are required");
        }
        const admin = yield prisma.admin.findUnique({
            where: { id: userId }
        });
        if (!admin) {
            return res.status(404).send("Admin not found");
        }
        // Increment the email sent count
        yield prisma.admin.update({
            where: { id: userId },
            data: { emailSent: admin.emailSent + 1 }
        });
        const emailList = yield prisma.email.findMany({
            select: { email: true }
        });
        if (emailList.length === 0) {
            return res.status(404).send("No subscribers found");
        }
        emailList.forEach((subscriber) => __awaiter(void 0, void 0, void 0, function* () {
            yield sendEmail(subject, body, subscriber.email);
        }));
        res.status(200).send("Email sent successfully");
    }
    catch (error) {
        console.error("Error sending email:", error);
        res.status(500).send("Error sending email");
    }
}));
// @ts-ignore
app.post("/send-test-email", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userId, subject, content } = req.body;
        if (!userId || !subject || !content) {
            return res.status(400).send("User ID, subject, and content are required");
        }
        const admin = yield prisma.admin.findUnique({
            where: { id: userId }
        });
        if (!admin) {
            return res.status(404).send("Admin not found");
        }
        // Increment the email sent count
        yield prisma.admin.findFirst({
            where: { id: userId },
        });
        yield sendEmail(subject, content, admin.email);
        res.status(200).send("Email sent successfully");
    }
    catch (error) {
        console.error("Error sending email:", error);
        res.status(500).send("Error sending email");
    }
}));
// Modified server startup for Vercel compatibility
if (process.env.NODE_ENV !== "production") {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}
// @ts-ignore
app.post("/add-subscriber", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, interests, currentPosition, currentCompany, currentLocation, interestedInJobs, skills, experienceYears, jobPreferences } = req.body;
        if (!email) {
            return res.status(400).send("Email is required");
        }
        // Check if the email already exists
        const existingEmail = yield prisma.email.findUnique({
            where: { email },
        });
        if (existingEmail) {
            return res.status(208).send("Email already exists");
        }
        if (interestedInJobs == true) {
            const newSubscriber = yield prisma.email.create({
                data: {
                    email,
                    interests,
                    currentPosition,
                    currentCompany,
                    currentLocation,
                    interestedInJobs,
                    skills,
                    experienceYears,
                    jobPreferences
                },
            });
            res.status(201).json({ id: newSubscriber.id, email: newSubscriber.email });
        }
        else {
            const newSubscriber = yield prisma.email.create({
                data: {
                    email,
                    interests,
                    currentPosition,
                    currentCompany,
                    currentLocation,
                    interestedInJobs,
                },
            });
            res.status(201).json({ id: newSubscriber.id, email: newSubscriber.email });
        }
    }
    catch (error) {
        console.error("Error adding subscriber:", error);
        res.status(500).send("Error adding subscriber");
    }
}));
const sendEmail = (subject, content, email) => __awaiter(void 0, void 0, void 0, function* () {
    const emailResponse = yield resend.emails.send({
        from: "Tensor Protocol <onboarding@tensorboy.com>",
        to: email,
        subject: subject,
        html: content
    });
});
// Export the Express app for Vercel
exports.default = app;
