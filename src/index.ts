import express from "express";
import { config } from "dotenv";
config();
import cors from "cors";
import { PrismaClient } from "../src/generated/prisma";
import bcrpyt from "bcrypt";
import { Resend } from "resend";
import { SendMailClient } from "zeptomail";

declare global {
    // eslint-disable-next-line no-var
    var prisma: PrismaClient | undefined;
}

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self' https://api.tensorboy.com;"
  );
  next();
});

const resend = new Resend(process.env.RESEND_API_KEY);

// Updated Prisma client instantiation for serverless environment
let prisma: PrismaClient;

if (process.env.NODE_ENV === "production") {
    prisma = new PrismaClient();
} else {
    // Prevent multiple instances during development/hot reloading
    if (!global.prisma) {
        global.prisma = new PrismaClient();
    }
    prisma = global.prisma;
}

const hashSalt = 10;

// @ts-ignore
app.post("/signup", async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !password) {
            return res.status(400).send("Username and password are required");
        }

        const existingUser = await prisma.admin.findUnique({
            where: { username },
        });

        if (existingUser) {
            return res.status(400).send("User already exists");
        }

        const hashedPassword = await bcrpyt.hash(password, hashSalt);

        const user = await prisma.admin.create({
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
});

// @ts-ignore
app.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).send("Username and password are required");
        }

        const user = await prisma.admin.findUnique({
            where: { username },
        });

        if (!user) {
            return res.status(404).send("User not found");
        }

        const isPasswordValid = await bcrpyt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).send("Invalid password");
        }

        res.status(200).json({ userId: user.id });
    } catch (error) {
        console.error("Error logging in:", error);
        res.status(500).send("Error logging in");
    }
});

// @ts-ignore
app.get("/total-subscribers", async (req, res) => {
    try {
        const totalSubscribers = await prisma.email.count();
        res.status(200).json({ totalSubscribers });
    }
    catch (error) {
        console.error("Error fetching total subscribers:", error);
        res.status(500).send("Error fetching total subscribers");
    }
});

// @ts-ignore
app.get("/total-emails", async (req, res) => {
    try {
        const { userId } = req.query;
        if (!userId) {
            return res.status(400).send("User ID is required");
        }
        const admin = await prisma.admin.findUnique({
            where: { id: userId as string }
        });
        if (!admin) {
            return res.status(404).send("Admin not found");
        }
        const totalEmails = admin.emailSent;
        res.status(200).json({ totalEmails });
    } catch (error) {
        console.error("Error fetching total emails:", error);
        res.status(500).send("Error fetching total emails");
    }
});

// @ts-ignore
app.post("/send-email", async (req, res) => {
    try {
        const { userId, subject, body } = req.body;
        if (!userId || !subject || !body) {
            console.error("Missing required fields:", { userId, subject, body });
            return res.status(400).send("User ID, subject, and body are required");
        }

        const admin = await prisma.admin.findUnique({
            where: { id: userId as string }
        });
        if (!admin) {
            return res.status(404).send("Admin not found");
        }

        // Increment the email sent count
        await prisma.admin.update({
            where: { id: userId as string },
            data: { emailSent: admin.emailSent + 1 }
        });

        const emailList = await prisma.email.findMany({
            select: { email: true }
        });

        if (emailList.length === 0) {
            return res.status(404).send("No subscribers found");
        }

        console.log(`Sending email to ${emailList.length} subscribers`);

        emailList.forEach(async (subscriber) => {
            console.log(`Sending email to: ${subscriber.email}`);
            await sendEmail(subject, body, subscriber.email);
        });

        res.status(200).send("Email sent successfully");
    } catch (error) {
        console.error("Error sending email:", error);
        res.status(500).send("Error sending email");
    }
});

// @ts-ignore
app.post("/send-test-email", async (req, res) => {
    try {
        const { userId, subject, content } = req.body;
        if (!userId || !subject || !content) {
            return res.status(400).send("User ID, subject, and content are required");
        }

        const admin = await prisma.admin.findUnique({
            where: { id: userId as string }
        });
        if (!admin) {
            return res.status(404).send("Admin not found");
        }

        // Increment the email sent count
        await prisma.admin.findFirst({
            where: { id: userId as string },
        });

        await sendEmail(subject, content, admin.email);

        res.status(200).send("Email sent successfully");
    } catch (error) {
        console.error("Error sending email:", error);
        res.status(500).send("Error sending email");
    }
});

// Modified server startup for Vercel compatibility
if (process.env.NODE_ENV !== "production") {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}


// @ts-ignore
app.post("/add-subscriber", async (req, res) => {
    try {
        const { email, interests, currentPosition, currentCompany, currentLocation, interestedInJobs, skills, experienceYears, jobPreferences, phoneNumber, resumeLink, fillLater } = req.body;
        if (!email) {
            return res.status(400).send("Email is required");
        }

        if (fillLater==true) {
            const newSubscriber = await prisma.email.create({
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
        const existingEmail = await prisma.email.findUnique({
            where: { email },
        });

        if (existingEmail) {
            if (interestedInJobs == true) {
                const newSubscriber = await prisma.email.update({
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
            } else {
                const newSubscriber = await prisma.email.update({
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
            const newSubscriber = await prisma.email.create({
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
        } else {
            const newSubscriber = await prisma.email.create({
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

    } catch (error) {
        console.error("Error adding subscriber:", error);
        res.status(500).send("Error adding subscriber");
    }
});


const sendEmail = async (subject: string, content: string, email: string) => {
    const emailResponse = await resend.emails.send({
        from: "Tensor Protocol <onboarding@tensorboy.com>",
        to: email,
        subject: subject,
        html: content
    });
    console.log(`Email sent to ${email}:`, emailResponse);
};



// @ts-ignore
app.post("/check-subscriber", async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).send("Email is required");
        }

        const subscriber = await prisma.email.findUnique({
            where: { email },
        });

        if (subscriber) {
            return res.status(200).json({ exists: true, subscriber });
        } else {
            return res.status(404).json({ exists: false });
        }
    } catch (error) {
        console.error("Error checking subscriber:", error);
        res.status(500).json({ error: true, message: "Error checking subscriber" });
    }
});

// @ts-ignore
app.post("/unsubscribe", async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).send("Email is required");
        }

        // Check if subscriber exists
        const subscriber = await prisma.email.findUnique({
            where: { email },
        });

        if (!subscriber) {
            return res.status(404).json({ success: false, message: "Subscriber not found" });
        }

        // Remove from Email table
        await prisma.email.deleteMany({
            where: { email },
        });

        res.status(200).json({ success: true, message: "Unsubscribed successfully" });
    } catch (error) {
        console.error("Error unsubscribing:", error);
        res.status(500).json({ success: false, message: "Error unsubscribing" });
    }
});

// @ts-ignore
app.post("/add-to-waitlist", async (req, res) => {
    try {
        const { email, ig_username, totalVotes, voteGiven, name } = req.body;
        if (!email) {
            return res.status(400).send("Email is required");
        }
        const subscriber = await prisma.email.findUnique({
            where: { email },
        });
        if (subscriber) {
            const newWaitlistEntry = await prisma.waitlist.create({
                data: {
                    email,
                    ig_username : ig_username || "",
                    totalVotes : totalVotes || 1,
                    voteGiven : voteGiven || 0,
                    name : name || "",
                }
            });
            res.status(201).json({ newWaitlistEntry, success : true });
        } else {
            return res.status(404).json({ success: false, message: "Subscriber not found in TP" });
        }
    } catch (error) {
        console.error("Error adding to waitlist:", error);
        res.status(500).json({ success: false, message: "Error adding to waitlist" });
    }
});


// @ts-ignore
app.get("/leaderboard", async (req, res) => {
    try {
        const waitlistEntries = await prisma.waitlist.findMany({
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
    } catch (error) {
        console.error("Error fetching leaderboard:", error);
        res.status(500).json({ error: true, message: "Error fetching leaderboard" });
    }
});

// @ts-ignore
app.post("/add-vote", async (req, res) => {
    try {
        const { email, contestant } = req.body;
        if (!email || !contestant) {
            return res.status(400).send("Email and contestant are required");
        }

        const subscriber = await prisma.email.findUnique({
            where: { email },
        });

        if (!subscriber) {
            return res.status(404).json({ success: false, message: "Subscriber not found in TP" });
        }

        const contestantData = await prisma.waitlist.findUnique({
            where: { id : contestant },
        });

        if (!contestantData) {
            return res.status(404).json({ success: false, message: "Waitlist entry not found" });
        }

        const updatedContestant = await prisma.waitlist.update({
            where: { id: contestant },
            data: {
                totalVotes: contestantData.totalVotes + 1,
            },
        });

        const existingUser = await prisma.waitlist.findUnique({
            where: { email: email },
        });

        if (!existingUser) {
            const newWaitlistEntry = await prisma.waitlist.create({
                data: {
                    email: email,
                    totalVotes: 1,
                    voteGiven: 1,
                    name : ""
                },
            });
            return res.status(201).json({ success: true, newWaitlistEntry });
        }

        else {
            if(existingUser.voteGiven >= 3){
                return res.status(400).json({ success: false, message: "You have already used all your votes" });
            }
            const updatedUser = await prisma.waitlist.update({
                where: { email: email },
                data: {
                    voteGiven: existingUser.voteGiven + 1,
                },
            });

            return res.status(200).json({ success: true, updatedUser });
        }

    } catch (error) {
        console.error("Error adding vote:", error);
        res.status(500).json({ success: false, message: "Error adding vote" });
    }
});



// @ts-ignore
app.get("/get-contestant", async (req, res) => {
    try {
        const { id } = req.query;
        if (!id) {
            return res.status(400).send("ID is required");
        }

        const contestant = await prisma.waitlist.findUnique({
            where: { id: id as string },
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
    } catch (error) {
        console.error("Error fetching contestant:", error);
        res.status(500).json({ success: false, message: "Error fetching contestant" });
    }
});



// @ts-ignore
app.post("/add-wallpaper", async (req, res) => {
  try {
    const { imageUrl, author } = req.body;
    if (!imageUrl || !author) {
      return res.status(400).json({ error: "Image URL and author are required." });
    }
    const newWallpaper = await prisma.wallpaper.create({
      data: {
        imageUrl,
        author,
      },
    });
    res.status(201).json({ success: true, wallpaper: newWallpaper });
  } catch (err) {
    console.error("Upload error:", err);
    return res.status(500).json({ success: false ,error: "Upload failed." });
  }
});

// @ts-ignore
app.get("/approved-wallpapers", async (req, res) => {
  try {
    const wallpapers = await prisma.wallpaper.findMany({
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
    } catch (err) {
    console.error("Fetch error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch wallpapers." });
    }
});


// @ts-ignore
app.get("/get-wallpapers", async (req, res) => {
  try {
    const wallpapers = await prisma.wallpaper.findMany({
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
  } catch (err) {
    console.error("Fetch error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch wallpapers." });
  }
});


// @ts-ignore
app.get("/get-wallpaper/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const wallpaper = await prisma.wallpaper.findUnique({
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
    } catch (err) {
        console.error("Fetch error:", err);
        return res.status(500).json({ success: false, error: "Failed to fetch wallpaper." });
    }
});

// @ts-ignore
app.delete("/delete-wallpaper/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const wallpaper = await prisma.wallpaper.findUnique({
            where: { id },
        });
        if (!wallpaper) {
            return res.status(404).json({ success: false, error: "Wallpaper not found." });
        }
        await prisma.wallpaper.delete({
            where: { id },
        });
        res.status(200).json({ success: true, message: "Wallpaper deleted successfully." });
    } catch (err) {
        console.error("Delete error:", err);
        return res.status(500).json({ success: false, error: "Failed to delete wallpaper." });
    }
});


// @ts-ignore
app.post("/approve-wallpaper", async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) {
            return res.status(400).json({ error: "Wallpaper ID is required." });
        }
        
        const wallpaper = await prisma.wallpaper.findUnique({
            where: { id },
        });
        
        if (!wallpaper) {
            return res.status(404).json({ success: false, error: "Wallpaper not found." });
        }
        
        await prisma.wallpaper.update({
            where: { id },
            data: { isApproved: true },
        });
        
        res.status(200).json({ success: true, message: "Wallpaper approved successfully." });
    } catch (err) {
        console.error("Approval error:", err);
        return res.status(500).json({ success: false, error: "Failed to approve wallpaper." });
    }
});

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

const test_body_html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Free Smart India Hackathon Masterclass</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f8f9fa;
        }
        
        .email-container {
            max-width: 600px;
            margin: 20px auto;
            background: #ffffff;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
        }
        
        .header {
            background: linear-gradient(135deg, #ff964f 0%, #d35501 100%);
            padding: 40px 30px;
            text-align: center;
            color: white;
            font-weight: bold;
        }
        
        .header h1 {
            font-size: 28px;
            font-weight: bold;
            margin-bottom: 8px;
            letter-spacing: -0.5px;
        }
        
        .header .subtitle {
            font-size: 16px;
            opacity: 0.98;
            font-weight: 300;
        }
        
        .badge {
            display: inline-block;
            background: rgba(255, 255, 255, 0.2);
            padding: 6px 16px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 500;
            margin-top: 15px;
            border: 1px solid rgba(255, 255, 255, 0.3);
        }
        
        .content {
            padding: 40px 30px;
        }
        
        .greeting {
            font-size: 18px;
            font-weight: 600;
            color: #222;
            margin-bottom: 20px;
        }
        
        .main-text {
            font-size: 16px;
            color: #555;
            margin-bottom: 25px;
            line-height: 1.7;
        }
        
        .highlight-box {
            background: #f8f9fa;
            border-left: 4px solid #ff6b35;
            padding: 20px;
            margin: 25px 0;
            border-radius: 0 8px 8px 0;
        }
        
        .highlight-text {
            font-size: 16px;
            color: #333;
            font-weight: 500;
        }
        
        .details-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin: 30px 0;
        }
        
        .detail-item {
            text-align: center;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 8px;
        }
        
        .detail-icon {
            font-size: 24px;
            margin-bottom: 8px;
        }
        
        .detail-label {
            font-size: 12px;
            color: #888;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
        }
        
        .detail-value {
            font-size: 16px;
            font-weight: 600;
            color: #222;
        }
        
        .cta-section {
            text-align: center;
            margin: 40px 0 30px 0;
        }
        
        .cta-button {
            display: inline-block;
            background-color: #000000;
            color: white;
            text-decoration: none;
            padding: 16px 40px;
            border-radius: 50px;
            font-weight: 600;
            font-size: 16px;
            transition: all 0.3s ease;
            box-shadow: 0 4px 15px rgba(255, 107, 53, 0.3);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .cta-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(255, 107, 53, 0.4);
        }
        
        .benefits {
            margin: 30px 0;
        }
        
        .benefit-item {
            display: flex;
            align-items: center;
            margin-bottom: 15px;
            font-size: 15px;
            color: #555;
        }
        
        .benefit-icon {
            width: 20px;
            height: 20px;
            background: #ff6b35;
            border-radius: 50%;
            margin-right: 15px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 12px;
        }
        
        .footer {
            background: #222;
            color: #ccc;
            padding: 30px;
            text-align: center;
            font-size: 14px;
        }
        
        .footer .signature {
            color: #ff6b35;
            font-weight: 600;
            margin-bottom: 10px;
        }
        
        .social-note {
            margin-top: 20px;
            font-size: 13px;
            color: #888;
            font-style: italic;
        }
        
        @media (max-width: 600px) {
            .email-container {
                margin: 10px;
                border-radius: 8px;
            }
            
            .header {
                padding: 30px 20px;
            }
            
            .header h1 {
                font-size: 50px;
            }
            
            .content {
                padding: 30px 20px;
            }
            
            .details-grid {
                grid-template-columns: 1fr;
                gap: 15px;
            }
            
            .cta-button {
                padding: 14px 30px;
                font-size: 15px;
            }
        }
    </style>
</head>
<body>
    <div class="email-container">
        <!-- Header Section -->
        <div class="header">
            <h1 style="font-size: 36px;">Smart India Hackathon</h1>
            <div class="subtitle">Masterclass with Former SIH Judge</div>
            <div class="badge">FREE SESSION</div>
        </div>
        
        <!-- Content Section -->
        <div class="content">
            <div class="greeting">Hey there! 👋</div>
            
            <div class="main-text">
                Hope you're doing amazing! I've been getting tons of messages about Smart India Hackathon guidance lately, and while I can't reply to everyone personally, I wanted to do something special for all of you.
            </div>
            
            <div class="highlight-box">
                <div class="highlight-text">
                    As a former SIH judge, I know exactly what separates winning teams from the rest, and I want to share those insights with you.
                </div>
            </div>
            
            <!-- Event Details -->
            <div class="details-grid">
                <div class="detail-item">
                    <div class="detail-icon">📅</div>
                    <div class="detail-label">Date</div>
                    <div class="detail-value">Sunday, 21st September</div>
                </div>
                <div class="detail-item">
                    <div class="detail-icon">🕘</div>
                    <div class="detail-label">Time</div>
                    <div class="detail-value">9:00 PM</div>
                </div>
            </div>
            
            <!-- Benefits -->
            <div class="benefits">
                <div class="benefit-item">
                    <div class="benefit-icon">✓</div>
                    <div>60 minutes of actionable SIH strategies</div>
                </div>
                <div class="benefit-item">
                    <div class="benefit-icon">✓</div>
                    <div>Insights from a former SIH judge</div>
                </div>
                <div class="benefit-item">
                    <div class="benefit-icon">✓</div>
                    <div>Completely FREE for everyone</div>
                </div>
                <div class="benefit-item">
                    <div class="benefit-icon">✓</div>
                    <div>Perfect for teams & individuals</div>
                </div>
            </div>
            
            <div class="main-text">
                Bring your team, share with your college friends - everyone's welcome!
            </div>
            
            <!-- Call to Action -->
            <div class="cta-section">
                <a href="https://forms.gle/3e6i73i6nKaE1ho46" class="cta-button" target="_blank" rel="noopener" style="background-color: #000000; color: white">
                    🎯 REGISTER NOW
                </a>
            </div>
            
            <div class="social-note">
                Share this with your friends and teammates - let's build something amazing together!
            </div>
        </div>
        
        <!-- Footer -->
        <div class="footer">
            <div class="signature">- Tensorboy ❤️</div>
            <div>Looking forward to seeing you there!</div>
        </div>
    </div>
</body>
</html>
`;

const zeptoClient = new SendMailClient({
  url: ZM_API_URL,
  token: ZM_TOKEN,
});

app.options("/send-welcome-email", (req, res) => {
  // Set CORS headers
  res.header("Access-Control-Allow-Origin", "*"); // Or specify allowed origins
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Max-Age", "86400"); // 24 hours
  res.status(204).end();
});

// @ts-ignore
app.post("/send-welcome-email", async (req, res) => {
    try {
        // Set CORS headers for the response
        res.header("Access-Control-Allow-Origin", "*"); // Or specify allowed origins
        res.header("Access-Control-Allow-Methods", "POST");
        res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
        
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

        await zeptoClient.sendMail({
            from: FROM,
            to: [{ email_address: { address: email, name: "" } }],
            subject: SUBJECT,
            htmlbody: HTML_BODY,
        });

        console.log(`✅ Welcome email sent to ${email}`);
        res.status(200).json({ success: true, message: "Welcome email sent successfully" });

    } catch (error) {
        console.error("Error sending welcome email:", error);
        res.status(500).json({ success: false, message: "Error sending welcome email" });
    }
});

// @ts-ignore
app.post("/send-zepto-email", async (req, res) => {
    try {
        const { email, name, subject, htmlBody } = req.body;
        
        if (!email || !subject || !htmlBody) {
            return res.status(400).json({ 
                success: false, 
                message: "Email, subject, and htmlBody are required" 
            });
        }

        await zeptoClient.sendMail({
            from: FROM,
            to: [{ email_address: { address: email, name: name || "" } }],
            subject: subject,
            htmlbody: htmlBody,
        });

        console.log(`✅ Email sent to ${email}`);
        res.status(200).json({ success: true, message: "Email sent successfully" });

    } catch (error) {
        console.error("Error sending email via ZeptoMail:", error);
        res.status(500).json({ success: false, message: "Error sending email" });
    }
});

// @ts-ignore
app.post("/send-demo-email", async (req, res) => {
    try {

        await zeptoClient.sendMail({
            from: FROM,
            to: [ { email_address: { address: "nikhilnitro5@gmail.com", name: "Nikhil" } }, { email_address: { address: "sayantannandi13@gmail.com", name: "Sayantan" } }, { email_address: { address: "manav.gupta1613@gmail.com", name: "Manav" } } ],
            subject: "Free Smart India Hackathon Masterclass - Sunday 9 PM ❤",
            htmlbody: test_body_html,
        });

        console.log(`✅ Email sent`);
        res.status(200).json({ success: true, message: "Email sent successfully" });

    } catch (error) {
        console.error("Error sending email via ZeptoMail:", error);
        res.status(500).json({ success: false, message: "Error sending email" });
    }
});


// Export the Express app for Vercel
export default app;
