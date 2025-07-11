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
const zeptomail_1 = require("zeptomail");
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
            console.error("Missing required fields:", { userId, subject, body });
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
        console.log(`Sending email to ${emailList.length} subscribers`);
        emailList.forEach((subscriber) => __awaiter(void 0, void 0, void 0, function* () {
            console.log(`Sending email to: ${subscriber.email}`);
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
        const { email, interests, currentPosition, currentCompany, currentLocation, interestedInJobs, skills, experienceYears, jobPreferences, phoneNumber, resumeLink, fillLater } = req.body;
        if (!email) {
            return res.status(400).send("Email is required");
        }
        if (fillLater == true) {
            const newSubscriber = yield prisma.email.create({
                data: {
                    email,
                    interests,
                    currentPosition,
                    currentCompany,
                    currentLocation,
                    interestedInJobs: false,
                    fillLater
                },
            });
            res.status(201).json({ id: newSubscriber.id, email: newSubscriber.email });
        }
        // Check if the email already exists
        const existingEmail = yield prisma.email.findUnique({
            where: { email },
        });
        if (existingEmail) {
            if (interestedInJobs == true) {
                const newSubscriber = yield prisma.email.update({
                    where: { email: existingEmail.email },
                    data: {
                        interests,
                        currentPosition,
                        currentCompany,
                        currentLocation,
                        interestedInJobs,
                        skills,
                        experienceYears,
                        jobPreferences,
                        phoneNumber,
                        resumeLink
                    },
                });
                res.status(201).json({ id: newSubscriber.id, email: newSubscriber.email });
            }
            else {
                const newSubscriber = yield prisma.email.update({
                    where: { email: existingEmail.email },
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
                    jobPreferences,
                    phoneNumber,
                    resumeLink
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
    console.log(`Email sent to ${email}:`, emailResponse);
});
// @ts-ignore
app.post("/check-subscriber", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).send("Email is required");
        }
        const subscriber = yield prisma.email.findUnique({
            where: { email },
        });
        if (subscriber) {
            return res.status(200).json({ exists: true, subscriber });
        }
        else {
            return res.status(404).json({ exists: false });
        }
    }
    catch (error) {
        console.error("Error checking subscriber:", error);
        res.status(500).json({ error: true, message: "Error checking subscriber" });
    }
}));
// @ts-ignore
app.post("/add-to-waitlist", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, ig_username, totalVotes, voteGiven, name } = req.body;
        if (!email) {
            return res.status(400).send("Email is required");
        }
        const subscriber = yield prisma.email.findUnique({
            where: { email },
        });
        if (subscriber) {
            const newWaitlistEntry = yield prisma.waitlist.create({
                data: {
                    email,
                    ig_username: ig_username || "",
                    totalVotes: totalVotes || 1,
                    voteGiven: voteGiven || 0,
                    name: name || "",
                }
            });
            res.status(201).json({ newWaitlistEntry, success: true });
        }
        else {
            return res.status(404).json({ success: false, message: "Subscriber not found in TP" });
        }
    }
    catch (error) {
        console.error("Error adding to waitlist:", error);
        res.status(500).json({ success: false, message: "Error adding to waitlist" });
    }
}));
// @ts-ignore
app.get("/leaderboard", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const waitlistEntries = yield prisma.waitlist.findMany({
            orderBy: {
                totalVotes: 'desc',
            },
            select: {
                id: true,
                email: true,
                ig_username: true,
                totalVotes: true,
                voteGiven: true,
                name: true,
            }
        });
        if (waitlistEntries.length === 0) {
            return res.status(404).json({ message: "No entries found in the waitlist" });
        }
        res.status(200).json(waitlistEntries);
    }
    catch (error) {
        console.error("Error fetching leaderboard:", error);
        res.status(500).json({ error: true, message: "Error fetching leaderboard" });
    }
}));
// @ts-ignore
app.post("/add-vote", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, contestant } = req.body;
        if (!email || !contestant) {
            return res.status(400).send("Email and contestant are required");
        }
        const subscriber = yield prisma.email.findUnique({
            where: { email },
        });
        if (!subscriber) {
            return res.status(404).json({ success: false, message: "Subscriber not found in TP" });
        }
        const contestantData = yield prisma.waitlist.findUnique({
            where: { id: contestant },
        });
        if (!contestantData) {
            return res.status(404).json({ success: false, message: "Waitlist entry not found" });
        }
        const updatedContestant = yield prisma.waitlist.update({
            where: { id: contestant },
            data: {
                totalVotes: contestantData.totalVotes + 1,
            },
        });
        const existingUser = yield prisma.waitlist.findUnique({
            where: { email: email },
        });
        if (!existingUser) {
            const newWaitlistEntry = yield prisma.waitlist.create({
                data: {
                    email: email,
                    totalVotes: 1,
                    voteGiven: 1,
                    name: ""
                },
            });
            return res.status(201).json({ success: true, newWaitlistEntry });
        }
        else {
            if (existingUser.voteGiven >= 3) {
                return res.status(400).json({ success: false, message: "You have already used all your votes" });
            }
            const updatedUser = yield prisma.waitlist.update({
                where: { email: email },
                data: {
                    voteGiven: existingUser.voteGiven + 1,
                },
            });
            return res.status(200).json({ success: true, updatedUser });
        }
    }
    catch (error) {
        console.error("Error adding vote:", error);
        res.status(500).json({ success: false, message: "Error adding vote" });
    }
}));
// @ts-ignore
app.get("/get-contestant", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.query;
        if (!id) {
            return res.status(400).send("ID is required");
        }
        const contestant = yield prisma.waitlist.findUnique({
            where: { id: id },
            select: {
                id: true,
                email: true,
                ig_username: true,
                totalVotes: true,
                voteGiven: true,
                name: true,
            }
        });
        if (!contestant) {
            return res.status(404).json({ success: false, message: "Contestant not found" });
        }
        res.status(200).json({ success: true, contestant });
    }
    catch (error) {
        console.error("Error fetching contestant:", error);
        res.status(500).json({ success: false, message: "Error fetching contestant" });
    }
}));
// @ts-ignore
app.post("/add-wallpaper", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { imageUrl, author } = req.body;
        if (!imageUrl || !author) {
            return res.status(400).json({ error: "Image URL and author are required." });
        }
        const newWallpaper = yield prisma.wallpaper.create({
            data: {
                imageUrl,
                author,
            },
        });
        res.status(201).json({ success: true, wallpaper: newWallpaper });
    }
    catch (err) {
        console.error("Upload error:", err);
        return res.status(500).json({ success: false, error: "Upload failed." });
    }
}));
// @ts-ignore
app.get("/approved-wallpapers", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const wallpapers = yield prisma.wallpaper.findMany({
            where: {
                isApproved: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
            select: {
                id: true,
                imageUrl: true,
            }
        });
        res.status(200).json({ success: true, wallpapers });
    }
    catch (err) {
        console.error("Fetch error:", err);
        return res.status(500).json({ success: false, error: "Failed to fetch wallpapers." });
    }
}));
// @ts-ignore
app.get("/get-wallpapers", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const wallpapers = yield prisma.wallpaper.findMany({
            orderBy: {
                createdAt: 'desc',
            },
            select: {
                id: true,
                imageUrl: true,
                author: true,
                isApproved: true,
            }
        });
        res.status(200).json({ success: true, wallpapers });
    }
    catch (err) {
        console.error("Fetch error:", err);
        return res.status(500).json({ success: false, error: "Failed to fetch wallpapers." });
    }
}));
// @ts-ignore
app.get("/get-wallpaper/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const wallpaper = yield prisma.wallpaper.findUnique({
            where: { id },
            select: {
                id: true,
                imageUrl: true,
            }
        });
        if (!wallpaper) {
            return res.status(404).json({ success: false, error: "Wallpaper not found." });
        }
        res.status(200).json({ success: true, wallpaper });
    }
    catch (err) {
        console.error("Fetch error:", err);
        return res.status(500).json({ success: false, error: "Failed to fetch wallpaper." });
    }
}));
// @ts-ignore
app.delete("/delete-wallpaper/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const wallpaper = yield prisma.wallpaper.findUnique({
            where: { id },
        });
        if (!wallpaper) {
            return res.status(404).json({ success: false, error: "Wallpaper not found." });
        }
        yield prisma.wallpaper.delete({
            where: { id },
        });
        res.status(200).json({ success: true, message: "Wallpaper deleted successfully." });
    }
    catch (err) {
        console.error("Delete error:", err);
        return res.status(500).json({ success: false, error: "Failed to delete wallpaper." });
    }
}));
// @ts-ignore
app.post("/approve-wallpaper", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.body;
        if (!id) {
            return res.status(400).json({ error: "Wallpaper ID is required." });
        }
        const wallpaper = yield prisma.wallpaper.findUnique({
            where: { id },
        });
        if (!wallpaper) {
            return res.status(404).json({ success: false, error: "Wallpaper not found." });
        }
        yield prisma.wallpaper.update({
            where: { id },
            data: { isApproved: true },
        });
        res.status(200).json({ success: true, message: "Wallpaper approved successfully." });
    }
    catch (err) {
        console.error("Approval error:", err);
        return res.status(500).json({ success: false, error: "Failed to approve wallpaper." });
    }
}));
// ZeptoMail configuration
const ZM_API_URL = "https://api.zeptomail.in/";
const ZM_TOKEN = "Zoho-enczapikey PHtE6r0EQu7vimMs+hUD5fCwQs/1Mo59qeMzJVZDso5GWadRFk0E/YstkWSwrxd7AflBHPWYwYxpsrKZt7+EJ2zkPWhFX2qyqK3sx/VYSPOZsbq6x00asV4ZcE3bUoHsd9Vo0iXXv9jfNA==";
const FROM = {
    address: "onboarding@tensorboy.com",
    name: "Tensorboy"
};
const SUBJECT = "Welcome to Tensor Protocol! 🚀";
const HTML_BODY = `<div class="variant">
    <div class="email-container">
        <div style="background: #000; color: #b8460e; padding: 25px; font-family: monospace;">
            <div style="font-size: 14px; margin-bottom: 15px; opacity: 0.7;">
                tensorboy@newsletter ~ %
            </div>
            <h1 style="margin: 0; font-size: 28px; font-weight: normal;">tensor-protocol --init</h1>
        </div>

        <div style="padding: 30px; background: white;">

            <!-- Intro/content block -->
            <div style="font-family: monospace; font-size: 14px; color: #b8460e; margin-bottom: 20px;">
                > Loading neural networks... ████████████ 100%
            </div>

            <h2 style="color: #333; font-weight: 300; font-size: 26px; margin: 0 0 25px 0; font-family: monospace;">System Initialized</h2>

            <p style="font-size: 18px; line-height: 1.8; margin: 0 0 25px 0; color: #000; font-family: monospace;">
                Hello Maalik,<br><br>
                Welcome to what's basically my love letter to the AI community – <strong style="color: #b8460e; font-family: monospace;">Tensor Protocol</strong>! This is where I spill all the tea ☕ on AI breakthroughs, share those golden hackathon secrets we all wish we knew earlier, and basically become your bandi for landing those dream internships.<br><br>
                Oh, and expect some serious sarcasm because, let's face it, we're all lonely and a little dead inside, doom scrolling for a gf/bf.<br><br>
                Real talk: why did this take <strong>FOREVER</strong> to launch?<br><br>
                Look, I'm gonna be brutally honest here. I had these massive plans, right? But then life happened. I got completely absorbed in this content that was acting like a rebellious teenager, and... okay fine, I was also scared to hit that publish button 😬<br><br>
                But you know what? Sometimes the best things come from those messy, imperfect moments. We're all just figuring it out as we go!<br><br>
                I'm <strong>BACK</strong> and ready to change the game! 🎯
            </p>

            <!-- Features list -->
            <div style="margin: 30px 0;">
                <h3 style="color: #333; font-size: 22px; font-weight: 400; margin: 0 0 20px 0; font-family: monospace;">Your new weekly dose of awesome includes:</h3>

                <div style="font-family: monospace; font-size: 18px; line-height: 2;">
                    <div style="margin-bottom: 12px; color:#000;">
                        •  <strong style="color: #b8460e;">AI Deep Dives:</strong> Real explanations that won't make your brain hurt + those secret sauce tips that actually boost performance 🧠⚡
                    </div>
                    <div style="margin-bottom: 12px; color:#000;">
                        •  <strong style="color: #b8460e;">Hackathon Reality Check:</strong> The events worth your sleep deprivation + honest winner breakdowns & pitch strategies that work
                    </div>
                    <div style="margin-bottom: 12px; color:#000;">
                        •  <strong style="color: #b8460e;">Internship Gold Mine:</strong> Those opportunities everyone's fighting for + the application secrets they don't teach in school
                    </div>
                    <div style="margin-bottom: 12px; color:#000;">
                        •  <strong style="color: #b8460e;">Developer Toolkit:</strong> Code snippets that'll save your life, hidden gems, and those "why didn't I know this sooner" resources
                    </div>
                    <div style="margin-bottom: 12px; color:#000;">
                        •  <strong style="color: #b8460e;">Community Love:</strong> Celebrating YOUR incredible projects because this journey is so much better together 🤝
                    </div>
                </div>
            </div>



<div style="margin-top: 15px;">
                <h1 style="color: #000; padding: 25px; padding-left:0px; font-family: monospace; font-size: 20px;">- tensorboy</h1>
            </div>


            <!-- Social links footer -->
            <div style="margin-top: 30px; font-family: monospace; font-size: 14px; color: #666;">
                Connect with us:
                <a href="https://www.linkedin.com/company/plutolabs-stealth/" style="color: #b8460e; text-decoration: none; margin: 0 8px;">LinkedIn</a>|
                <a href="mailto:manav@tensorboy.com" style="color: #b8460e; text-decoration: none; margin: 0 8px;">Email</a>|
                <a href="https://instagram.com/tensor._.boy" style="color: #b8460e; text-decoration: none; margin: 0 8px;">Instagram</a>
            </div>
        </div>
    </div>
</div>
`;
const zeptoClient = new zeptomail_1.SendMailClient({
    url: ZM_API_URL,
    token: ZM_TOKEN,
});
// @ts-ignore
app.post("/send-welcome-email", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, message: "Email is required" });
        }
        // Check if subscriber exists in the database
        // const subscriber = await prisma.email.findUnique({
        //     where: { email },
        // });
        // if (!subscriber) {
        //     return res.status(404).json({ success: false, message: "Subscriber not found in TP" });
        // }
        yield zeptoClient.sendMail({
            from: FROM,
            to: [{ email_address: { address: email, name: "" } }],
            subject: SUBJECT,
            htmlbody: HTML_BODY,
        });
        console.log(`✅ Welcome email sent to ${email}`);
        res.status(200).json({ success: true, message: "Welcome email sent successfully" });
    }
    catch (error) {
        console.error("Error sending welcome email:", error);
        res.status(500).json({ success: false, message: "Error sending welcome email" });
    }
}));
// @ts-ignore
app.post("/send-zepto-email", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, name, subject, htmlBody } = req.body;
        if (!email || !subject || !htmlBody) {
            return res.status(400).json({
                success: false,
                message: "Email, subject, and htmlBody are required"
            });
        }
        yield zeptoClient.sendMail({
            from: FROM,
            to: [{ email_address: { address: email, name: name || "" } }],
            subject: subject,
            htmlbody: htmlBody,
        });
        console.log(`✅ Email sent to ${email}`);
        res.status(200).json({ success: true, message: "Email sent successfully" });
    }
    catch (error) {
        console.error("Error sending email via ZeptoMail:", error);
        res.status(500).json({ success: false, message: "Error sending email" });
    }
}));
// Export the Express app for Vercel
exports.default = app;
