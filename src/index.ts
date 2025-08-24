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
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta http-equiv="x-ua-compatible" content="ie=edge" />
        <style type="text/css">
            /* Mobile tweaks */
            @media only screen and (max-width: 600px) {
                .wr { padding: 12px !important; }
                .ct { max-width: 100% !important; width: 100% !important; border-radius: 0 !important; }
                .pad-lg { padding: 20px !important; }
                .pad-sec { padding: 12px 16px 10px 16px !important; }
                .pad-card { padding: 16px !important; }
                .h1 { font-size: 22px !important; line-height: 1.3 !important; }
                .h2 { font-size: 18px !important; line-height: 1.4 !important; }
                .h3 { font-size: 16px !important; }
                .txt { font-size: 15px !important; line-height: 1.7 !important; }
                a { word-break: break-word !important; }
                ul { padding-left: 18px !important; }
            }
            /* Slightly wider body on desktops to use space */
            @media only screen and (min-width: 1024px) {
                .ct { max-width: 1000px !important; }
            }
        </style>
    </head>
    <body style="margin:0; padding:0; background:#f6f8fb;">
        <!-- Wrapper -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;">
            <tr>
        <td align="center" style="padding:32px;" class="wr">
                    <!-- Container -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ct" style="max-width:840px; width:100%; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 2px 6px rgba(0,0,0,0.04);">
                        <!-- Header -->
                        <tr>
                            <td style="background:#000000; color:#b8460e; padding:36px 36px 28px 36px; font-family:monospace;" class="pad-lg">
                                <div style="font-size:14px; margin-bottom:12px; opacity:0.7;">tensor@protocol ~ %</div>
                                <h1 style="margin:0; font-size:28px; font-weight:400; line-height:1.2;" class="h1">🚀 This week's AI & Tech highlights</h1>
                            </td>
                        </tr>

                        <!-- Intro -->
                        <tr>
                            <td style="padding:36px; font-family:monospace;" class="pad-lg">
                                <h2 style="color:#111; font-weight:300; font-size:22px; line-height:1.5; margin:0;" class="h2">
                                    Episode 2 of Tensor Protocol 🚀
                                </h2>
                            </td>
                        </tr>

                        <!-- Card: Top AI News -->
                        <tr>
                            <td style="padding:0 36px 12px 36px;" class="pad-sec">
                                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff; border:1px solid #eceff3; border-radius:10px;">
                                    <tr>
                                        <td style="padding:24px 28px 12px 28px;" class="pad-card txt">
                                            <h3 style="margin:0 0 12px 0; color:#333; font-size:18px; font-weight:600; font-family:monospace;" class="h3">Hackathons</h3>
                                            <ul style="margin:0; padding:0 0 0 18px; color:#000; font-family:monospace; font-size:16px; line-height:1.8;" class="txt">
                                                <li><a href="https://hackodisha-4.devfolio.co/?ref=cb69774eda" style="color:#b8460e; text-decoration:none; font-weight:600;">HackOdisha 5.0</a></li>
                                                <li><a href="https://lu.ma/T1-Hack25-Delhi" style="color:#b8460e; text-decoration:none; font-weight:600;">Team1 Hackathon</a></li>
                                                <li><a href="https://unstop.com/hackathons/hackshastra-hackshastra-1544473" style="color:#b8460e; text-decoration:none; font-weight:600;">HackShastra</a></li>
                                                <li><a href="https://www.naukri.com/campus/contests/32816?action=enrol&utm_source=32816_conteststartmail&utm_medium=email&utm_campaign=contestinformation&utm_content=930_naukri_campus_contest_reg_start_1_day_naukri_campus_contest_reg_start_1_day_start_b5a9&utm_term=655774" style="color:#b8460e; text-decoration:none; font-weight:600;">HP Dreams Unlocked</a></li>
                                                <li><a href="https://unstop.com/hackathons/nextgen-hackathon-soft-computing-research-society-new-delhi-delhi-1543393?lb=KgDPHgd5&utm_medium=Share&utm_source=nikhisin5306&utm_campaign=Innovation_challenge" style="color:#b8460e; text-decoration:none; font-weight:600;">NextGen Hackathon</a></li>
                                                <li><a href="https://unstop.com/hackathons/nextgen-hackathon-soft-computing-research-society-new-delhi-delhi-1543393?lb=KgDPHgd5&utm_medium=Share&utm_source=nikhisin5306&utm_campaign=Innovation_challenge" style="color:#b8460e; text-decoration:none; font-weight:600;">Fintech AI Hackathon</a></li>
                                            </ul>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>

                        <!-- Card: Trending Signals -->
                        <tr>
                            <td style="padding:20px 36px 12px 36px;" class="pad-sec">
                                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff; border:1px solid #eceff3; border-radius:10px;">
                                    <tr>
                                        <td style="padding:24px 28px 12px 28px;" class="pad-card txt">
                                            <h3 style="margin:0 0 12px 0; color:#333; font-size:18px; font-weight:600; font-family:monospace;" class="h3">Internships</h3>
                                            <ul style="margin:0; padding:0 0 0 18px; color:#000; font-family:monospace; font-size:16px; line-height:1.8;" class="txt">
                                                <li>🚀 <a href="https://jobs.lever.co/upstox/f09dc8bb-d213-41cf-8289-ce48fec7d1a7" style="color:#b8460e; text-decoration:none; font-weight:600;">Upstox</a> Hiring SDE Frontend Intern | Freshers | 50k/month</li>
                                                <li><a href="https://job-boards.greenhouse.io/66degrees/jobs/5629492004?gh_src=ec8883c14us" style="color:#b8460e; text-decoration:none; font-weight:600;">Associate Software Engineer, Gradient Specialist</a></li>
                                                <li><a href="https://wd1.myworkdaysite.com/recruiting/wf/WellsFargoJobs/job/Bengaluru-India/Analytics-Associate--Global-Payments-and-Liquidity_R-482558-1" style="color:#b8460e; text-decoration:none; font-weight:600;">Analytics Associate – Global Payments and Liquidity</a></li>
                                                <li><a href="https://careers.mastercard.com/us/en/job/MASRUSR257978EXTERNALENUS/Software-Engineer-I" style="color:#b8460e; text-decoration:none; font-weight:600;">Mastercard Software Engineer I</a> | Fresher | 17.6 LPA</li>
                                                <li><a href="https://mcafee.wd1.myworkdayjobs.com/External/job/India-Bengaluru/Software-Development-Engineer_JR0032026" style="color:#b8460e; text-decoration:none; font-weight:600;">McAfee Software Development Engineer</a> | Fresher | 12.7 LPA</li>
                                            </ul>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>

                        <!-- Card: Career Spotlight -->
                        <tr>
                            <td style="padding:20px 36px 12px 36px;" class="pad-sec">
                                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff; border:1px solid #eceff3; border-radius:10px;">
                                    <tr>
                                        <td style="padding:24px 28px 12px 28px;" class="pad-card txt">
                                            <h3 style="margin:0 0 12px 0; color:#333; font-size:18px; font-weight:600; font-family:monospace;" class="h3">AI Tool - PRERPLEXITY COMET -</h3>
                                            <ul style="margin:0; padding:0 0 0 18px; color:#000; font-family:monospace; font-size:16px; line-height:1.8;" class="txt">
                                                <li><strong>Link:</strong> <a href="https://www.perplexity.ai/comet" style="color:#b8460e; text-decoration:none; font-weight:600;">Perplexity Comet</a></li>
                                                <li><strong>How you can use:</strong> <a href="https://www.instagram.com/reel/DNiyjxMSZ3C/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==" style="color:#b8460e; text-decoration:none;">Instagram Reel Guide</a></li>
                                            </ul>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>

                        <!-- Card: Tutorials of the Week -->
                        <tr>
                            <td style="padding:20px 36px 12px 36px;" class="pad-sec">
                                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff; border:1px solid #eceff3; border-radius:10px;">
                                    <tr>
                                        <td style="padding:24px 28px 12px 28px;" class="pad-card txt">
                                            <h3 style="margin:0 0 12px 0; color:#333; font-size:18px; font-weight:600; font-family:monospace;" class="h3">News</h3>
                                            <div style="margin:0; padding:0; color:#000; font-family:monospace; font-size:16px; line-height:1.7;" class="txt">
                                                <strong><a href="https://podcasts.apple.com/us/podcast/amazon-is-betting-on-agents-to-win-the-ai-race/id1011668648?i=1000722930083" style="color:#b8460e; text-decoration:none;">🚀 Amazon's AGI Strategy: "Reverse Acquihires"</a></strong><br>
                                                Amazon is conducting “reverse acquihires” – recruiting top researchers and giving them billion‑dollar compute clusters instead of traditional acquisitions. This pairs elite talent with massive resources in their AGI push.<br><br>
                                                <strong><a href="https://openai.com/policies/unauthorized-openai-equity-transactions/?utm_source=newsletter.theresanaiforthat.com&utm_medium=newsletter&utm_campaign=amazon-s-agi-strategy-gpt-6&_bhlid=4be4b95a9a4b498345dc0a755ff06f41a7bc6542" style="color:#b8460e; text-decoration:none;">⚠️ OpenAI Equity Warning: SPV Shares Have No Value</a></strong><br>
                                                OpenAI warns investors that unauthorized SPV share purchases carry no value or rights—mirroring Anthropic’s tighter ownership stance amid high demand.<br><br>
                                                <strong><a href="https://www.theinformation.com/articles/nvidia-orders-halt-h20-production-china-directive-purchases?utm_source=newsletter.theresanaiforthat.com&utm_medium=newsletter&utm_campaign=amazon-s-agi-strategy-gpt-6&_bhlid=923033e5155fcfce786d94b3da57742a05eb1571" style="color:#b8460e; text-decoration:none;">🛡️ Nvidia Halts China Chip Shipments Amid Security Concerns</a></strong><br>
                                                Nvidia pauses H20 AI processor shipments to China after regulatory warnings about “security risks,” underscoring geopolitical tension and China’s domestic chip ambitions.<br><br>
                                                <strong><a href="https://api-docs.deepseek.com/news/news250821?utm_source=alphasignal&utm_campaign=2025-08-21&asuniq=e312e687" style="color:#b8460e; text-decoration:none;">🤖 Introducing DeepSeek-V3.1: Our first step toward the agent era! 🚀</a></strong>
                                                <ul style="margin:0 0 0 18px; padding:0;">
                                                    <li>🧠 Hybrid inference: Think & Non-Think — one model, two modes</li>
                                                    <li>⚡️ Faster thinking: DeepSeek-V3.1 Think answers faster than DeepSeek-R1-0528</li>
                                                    <li>🛠️ Stronger agent skills: Enhanced tool use & multi-step task handling</li>
                                                </ul>
                                                <br>
                                            </div>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>

                        <!-- Card: Fresh Jobs & Internships -->
                        <tr>
                            <td style="padding:16px 28px 6px 28px;" class="pad-sec">
                                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff; border:1px solid #eceff3; border-radius:10px;">
                                    <tr>
                                        <td style="padding:24px 28px 14px 28px;" class="pad-card txt">
                                            <h3 style="margin:0 0 12px 0; color:#333; font-size:18px; font-weight:600; font-family:monospace;" class="h3">More Latest News</h3>
                                            <ul style="margin:0; padding:0 0 0 18px; color:#000; font-family:monospace; font-size:16px; line-height:1.9;" class="txt">
                                                <li><a href="https://elevenlabs.io/v3?utm_source=alphasignal&utm_campaign=2025-08-21&asuniq=0d002eee" style="color:#b8460e; text-decoration:none;">ElevenLabs launches v3 (alpha) API for expressive text-to-speech</a></li>
                                                <li><a href="https://research.nvidia.com/labs/adlr/NVIDIA-Nemotron-Nano-2/?utm_source=alphasignal&utm_campaign=2025-08-21&asuniq=7cc49210" style="color:#b8460e; text-decoration:none;">NVIDIA unveils tiny open-source reasoning models, 6× faster than rivals</a></li>
                                                <li><a href="https://github.blog/news-insights/product-news/agents-panel-launch-copilot-coding-agent-tasks-anywhere-on-github/?utm_source=alphasignal&utm_campaign=2025-08-21&asuniq=84694306" style="color:#b8460e; text-decoration:none;">GitHub launches Copilot coding agent tasks that work anywhere on the platform</a></li>
                                            </ul>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>

                        <!-- Card: Quick Bites -->
                        <tr>
                            <td style="padding:20px 36px 12px 36px;" class="pad-sec">
                                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff; border:1px solid #eceff3; border-radius:10px;">
                                    <tr>
                                        <td style="padding:24px 28px 14px 28px;" class="pad-card txt">
                                            <h3 style="margin:0 0 12px 0; color:#333; font-size:18px; font-weight:600; font-family:monospace;" class="h3">Top Tutorials</h3>
                                            <ul style="margin:0; padding:0 0 0 18px; color:#000; font-family:monospace; font-size:16px; line-height:1.8;" class="txt">
                                                <li><a href="https://link.alphasignal.ai/tip3u4" style="color:#b8460e; text-decoration:none;">Google shows how to create Market Research Agents with Gemini</a></li>
                                                <li><a href="https://link.alphasignal.ai/T0OJJf" style="color:#b8460e; text-decoration:none;">Build an MCP workflow for image generation with Claude</a></li>
                                                <li><a href="https://link.alphasignal.ai/Eivo7y" style="color:#b8460e; text-decoration:none;">GitHub's tutorial on using Copilot to improve code reviews</a></li>
                                            </ul>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>

                        <!-- Signature -->
                        <tr>
                            <td style="padding:12px 36px 0 36px;" class="pad-sec">
                                <h1 style="margin:0; color:#000; padding:18px 0 0 0; font-family:monospace; font-size:20px; font-weight:400;">- tensorboy</h1>
                            </td>
                        </tr>

                        <!-- Footer -->
                        <tr>
                            <td style="padding:14px 36px 36px 36px;" class="pad-sec">
                                <div style="margin-top:12px; font-family:monospace; font-size:14px; color:#666;">
                                    Connect with us:
                                    <a href="https://www.linkedin.com/in/--manav-gupta--/" style="color:#b8460e; text-decoration:none; margin:0 8px;">LinkedIn</a>|
                                    <a href="mailto:manav.tensorboy@gmail.com" style="color:#b8460e; text-decoration:none; margin:0 8px;">Email</a>|
                                    <a href="https://instagram.com/tensor._.boy" style="color:#b8460e; text-decoration:none; margin:0 8px;">Instagram</a>
                                </div>
                            </td>
                        </tr>
                    </table>
                    <!-- /Container -->
                </td>
            </tr>
        </table>
        <!-- /Wrapper -->
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
            to: [{ email_address: { address: "sayantannandi13@gmail.com", name: "Sayantan" } }],
            subject: "DEMO EMAIL",
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
