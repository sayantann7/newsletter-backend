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
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tensor Protocol</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f7fafc; font-family: monospace;">
    <table align="center" cellpadding="0" cellspacing="0" role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f7fafc;">
        <tr>
            <td align="center">
                <table align="center" cellpadding="0" cellspacing="0" role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff;">
                    <tr>
                        <td style="padding: 15px; color: #b8460e; background-color: #000000;">
                            <p style="margin: 0; line-height: 27px; font-size: 18px;"><b>tensor@protocol ~ %</b></p>
                            <p style="margin: 15px 0 0 0; line-height: 24px; font-size: 22px; font-weight: bold;">🚀 Episode 3 of Tensor Protocol</p>
                            <p style="margin: 10px 0 0 0; line-height: 24px; font-size: 16px; font-weight: bold;">This week's AI & Tech highlights</p>
                        </td>
                    </tr>

                    <tr><td style="height: 20px;"></td></tr>

                    <tr>
                        <td style="padding: 0 20px;">
                            <h3 style="margin: 0; line-height: 18px; font-size: 15px; font-weight: bold; color: #000000;">NEWS</h3>
                            <div style="border-bottom: 1px solid #000000; margin-top: 10px;"></div>
                        </td>
                    </tr>
                    <tr><td style="height: 15px;"></td></tr>
                    <tr>
                        <td style="padding: 0 20px;">
                            <h2 style="margin: 0; line-height: 20.4px; font-size: 17px; font-weight: bold;"><a href="https://techcrunch.com/2025/08/29/meta-updates-chatbot-rules-to-avoid-inappropriate-topics-with-teen-users/" style="text-decoration: none; color: #b8460e;">1. Meta updates chatbot rules to avoid inappropriate topics with teen users</a></h2>
                            <p style="margin: 5px 0 0 0; line-height: 22.5px; color: #000000; font-size: 15px;">Coverage: After reports of Meta’s AI chatbots having inappropriate conversations with minors, Meta is restricting its bots from engaging with teens about self-harm, suicide, eating disorders, and limiting certain AI personalities.</p>
                        </td>
                    </tr>
                    <tr><td><div style="margin: 15px auto; width: 95%; border-top: 1px solid #cccccc;"></div></td></tr>
                    <tr>
                        <td style="padding: 0 20px;">
                            <h2 style="margin: 0; line-height: 20.4px; font-size: 17px; font-weight: bold;"><a href="https://techcrunch.com/2025/08/29/mastodon-says-it-doesnt-have-the-means-to-comply-with-age-verification-laws/" style="text-decoration: none; color: #b8460e;">2. Mastodon says it doesn't 'have the means' to comply with age verification laws</a></h2>
                            <p style="margin: 5px 0 0 0; line-height: 22.5px; color: #000000; font-size: 15px;">Coverage: Mastodon’s decentralized network says it cannot enforce age verification for users; individual server owners must decide how to handle such laws.</p>
                        </td>
                    </tr>
                    <tr><td><div style="margin: 15px auto; width: 95%; border-top: 1px solid #cccccc;"></div></td></tr>
                    <tr>
                        <td style="padding: 0 20px;">
                            <h2 style="margin: 0; line-height: 20.4px; font-size: 17px; font-weight: bold;"><a href="https://techcrunch.com/2025/08/29/microsoft-and-uber-alum-raises-3m-for-yc-backed-munify-a-neobank-for-the-egyptian-diaspora/" style="text-decoration: none; color: #b8460e;">3. Microsoft and Uber alum raises $3M for YC-backed Munify, a neobank for the Egyptian diaspora</a></h2>
                            <p style="margin: 5px 0 0 0; line-height: 22.5px; color: #000000; font-size: 15px;">Coverage: Khalid Ashmawy launched Munify to help Egyptians abroad send money home and offer cross-border banking.</p>
                        </td>
                    </tr>
                    <tr><td><div style="margin: 15px auto; width: 95%; border-top: 1px solid #cccccc;"></div></td></tr>
                    <tr>
                        <td style="padding: 0 20px;">
                            <h2 style="margin: 0; line-height: 20.4px; font-size: 17px; font-weight: bold;"><a href="https://techcrunch.com/2025/08/29/whatsapp-fixes-zero-click-bug-used-to-hack-apple-users-with-spyware/" style="text-decoration: none; color: #b8460e;">4. WhatsApp fixes 'zero-click' bug used to hack Apple users with spyware</a></h2>
                            <p style="margin: 5px 0 0 0; line-height: 22.5px; color: #000000; font-size: 15px;">Coverage: WhatsApp patched a critical vulnerability that allowed targeted attacks (“zero-click” spyware) against iPhone and Mac users.</p>
                        </td>
                    </tr>
                    <tr><td><div style="margin: 15px auto; width: 95%; border-top: 1px solid #cccccc;"></div></td></tr>
                    <tr>
                        <td style="padding: 0 20px;">
                            <h2 style="margin: 0; line-height: 20.4px; font-size: 17px; font-weight: bold;"><a href="https://finance.yahoo.com/news/billionaire-ambani-taps-google-meta-131910370.html" style="text-decoration: none; color: #b8460e;">5. Billionaire Ambani taps Google, Meta to build India's AI backbone</a></h2>
                            <p style="margin: 5px 0 0 0; line-height: 22.5px; color: #000000; font-size: 15px;">Coverage: Reliance announced a new AI subsidiary and partnerships with Google, Meta, and possibly OpenAI to drive India’s AI infrastructure.</p>
                        </td>
                    </tr>
                    <tr><td><div style="margin: 15px auto; width: 95%; border-top: 1px solid #cccccc;"></div></td></tr>
                    <tr>
                        <td style="padding: 0 20px;">
                            <h2 style="margin: 0; line-height: 20.4px; font-size: 17px; font-weight: bold;"><a href="https://www.bbc.com/news/articles/ckgdjx0vgn3o" style="text-decoration: none; color: #b8460e;">6. Tesla challenges $243 million verdict in Autopilot death trial</a></h2>
                            <p style="margin: 5px 0 0 0; line-height: 22.5px; color: #000000; font-size: 15px;">Coverage: Tesla is appealing a $243M verdict over a fatal Autopilot-related crash, seeking to overturn or reduce the damages.</p>
                        </td>
                    </tr>
                    <tr><td><div style="margin: 15px auto; width: 95%; border-top: 1px solid #cccccc;"></div></td></tr>
                    <tr>
                        <td style="padding: 0 20px;">
                            <h2 style="margin: 0; line-height: 20.4px; font-size: 17px; font-weight: bold;"><a href="https://techcrunch.com/2025/08/15/tech-layoffs-2025-list/" style="text-decoration: none; color: #b8460e;">7. A comprehensive list of 2025 tech layoffs</a></h2>
                            <p style="margin: 5px 0 0 0; line-height: 22.5px; color: #000000; font-size: 15px;">Coverage: Continuously updated tracker of all the major layoffs in tech, from startups to giants, in 2025.</p>
                        </td>
                    </tr>
                    <tr><td><div style="margin: 15px auto; width: 95%; border-top: 1px solid #cccccc;"></div></td></tr>
                    <tr>
                        <td style="padding: 0 20px 20px 20px;">
                            <h2 style="margin: 0; line-height: 20.4px; font-size: 17px; font-weight: bold;"><a href="https://techcrunch.com/2024/12/26/the-fall-of-ev-startup-fisker-a-comprehensive-timeline/" style="text-decoration: none; color: #b8460e;">8. Henrik Fisker quietly wound down his nonprofit after his EV startup went bankrupt</a></h2>
                            <p style="margin: 5px 0 0 0; line-height: 22.5px; color: #000000; font-size: 15px;">Coverage: Details Fisker’s decline, bankruptcy, and the winding down of related nonprofit activity.</p>
                        </td>
                    </tr>
                    
                    <tr>
                        <td style="padding: 15px 20px 0 20px;">
                            <h3 style="margin: 0; line-height: 18px; font-size: 15px; font-weight: bold; color: #000000;">HACKATHONS</h3>
                            <div style="border-bottom: 1px solid #000000; margin-top: 10px;"></div>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 15px 20px;">
                            <p style="margin: 0 0 15px 0; line-height: 22.5px; font-size: 15px;"><a href="https://reskilll.com/hack/hereindia" style="text-decoration: none; color: #b8460e; font-weight: bold;">HERE India Hackathon: Women in Tech</a></p>
                            <p style="margin: 0 0 15px 0; line-height: 22.5px; font-size: 15px;"><a href="https://vision.hack2skill.com/event/genaiexchangehackathon?utm_source=hack2skill&utm_medium=homepage" style="text-decoration: none; color: #b8460e; font-weight: bold;">Gen AI Exchange Hackathon</a></p>
                            <p style="margin: 0 0 15px 0; line-height: 22.5px; font-size: 15px;"><a href="https://revenuecat-shipaton-2025.devpost.com/register" style="text-decoration: none; color: #b8460e; font-weight: bold;">RevenueCat Shipaton 2025</a></p>
                            <p style="margin: 0 0 15px 0; line-height: 22.5px; font-size: 15px;"><a href="https://hackvortex-codestorm-5.devpost.com/register?flow[data][challenge_id]=22991&flow[name]=register_for_challenge" style="text-decoration: none; color: #b8460e; font-weight: bold;">HackVortex Codestorm 5</a></p>
                            <p style="margin: 0 0 15px 0; line-height: 22.5px; font-size: 15px;"><a href="https://hackodisha-4.devfolio.co/overview" style="text-decoration: none; color: #b8460e; font-weight: bold;">HackOdisha 5.0</a></p>
                            <p style="margin: 0 0 15px 0; line-height: 22.5px; font-size: 15px;"><a href="https://thenewviews.com/upcoming-hackathons-in-india/" style="text-decoration: none; color: #b8460e; font-weight: bold;">Space Apps Challenge Noida</a></p>
                            <p style="margin: 0; line-height: 22.5px; font-size: 15px;"><a href="https://thenewviews.com/upcoming-hackathons-in-india/" style="text-decoration: none; color: #b8460e; font-weight: bold;">India Open Hackathon</a></p>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding: 15px 20px 0 20px;">
                            <h3 style="margin: 0; line-height: 18px; font-size: 15px; font-weight: bold; color: #000000;">AI TOOL - WRAP</h3>
                            <div style="border-bottom: 1px solid #000000; margin-top: 10px;"></div>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 15px 20px;">
                            <p style="margin: 0; line-height: 22.5px; color: #000000; font-size: 15px;">A blazingly fast, Rust-based terminal that's reimagined from the ground up to work like a modern app, with AI command search and workflows.</p>
                            <p style="margin: 10px 0; line-height: 22.5px; color: #000000; font-size: 15px;"><b>Link:</b> <a href="https://www.warp.dev/pricing?utm_source=youtube&utm_medium=influencer&utm_campaign=coding-agent&utm_content=tensorboy&coupon=TENSOR&type=dollar&plan=pro&amount=1&fbclid=PAVERDUAMfjRVleHRuA2FlbQIxMAABp6_HE4ZReBlFYFz8yxTeCY2SItgUGJRc92PzKJjrjYcL8LC_jz-prFYZUJr5_aem_Zm5w7VrYdRbzq2I2hvIfyw" style="color: #b8460e;">https://www.warp.dev/</a></p>
                            <p style="margin: 0; line-height: 22.5px; color: #000000; font-size: 15px;"><b>How to use:</b> <a href="https://www.instagram.com/reel/DNiyjxMSZ3C/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==" style="color: #b8460e;">Watch Reel</a></p>
                        </td>
                    </tr>
                    
                    <tr>
                        <td style="padding: 15px 20px 0 20px;">
                            <h3 style="margin: 0; line-height: 18px; font-size: 15px; font-weight: bold; color: #000000;">TOP TUTORIALS</h3>
                            <div style="border-bottom: 1px solid #000000; margin-top: 10px;"></div>
                        </td>
                    </tr>
                    <tr><td style="height: 15px;"></td></tr>
                    <tr>
                        <td style="padding: 0 20px;">
                             <h2 style="margin: 0; line-height: 20.4px; font-size: 17px; font-weight: bold;"><a href="https://www.ssp.sh/brain/will-ai-replace-humans/" style="text-decoration: none; color: #b8460e;">Will AI Replace Human Thinking? The Case for Writing and Coding Manually</a></h2>
                        </td>
                    </tr>
                     <tr><td><div style="margin: 15px auto; width: 95%; border-top: 1px solid #cccccc;"></div></td></tr>
                    <tr>
                        <td style="padding: 0 20px;">
                             <h2 style="margin: 0; line-height: 20.4px; font-size: 17px; font-weight: bold;"><a href="https://www.youtube.com/watch?v=GfH4QL4VqJ0" style="text-decoration: none; color: #b8460e;">The free Python documentary 'Python: The Documentary | An origin story' is now available on YouTube</a></h2>
                        </td>
                    </tr>
                    <tr><td style="height: 20px;"></td></tr>

                    <tr>
                        <td align="center" style="padding: 15px; border: 1px solid #000000; font-family: roboto, 'helvetica neue', helvetica, arial, sans-serif;">
                            <p style="margin: 0; line-height: 24px; color: #000000; font-size: 16px;"><strong>- tensorboy&nbsp;</strong></p>
                            <p style="margin: 5px 0 0 0; line-height: 24px; color: #000000; font-size: 16px;">Connect with me:
                                <a href="https://www.linkedin.com/in/--manav-gupta--/" style="color: #b8460e; text-decoration: none; margin: 0 8px;">LinkedIn</a>|
                                <a href="mailto:manav.tensorboy@gmail.com" style="color: #b8460e; text-decoration: none; margin: 0 8px;">Email</a>|
                                <a href="https://instagram.com/tensor._.boy" style="color: #b8460e; text-decoration: none; margin: 0 8px;">Instagram</a>
                            </p>
                        </td>
                    </tr>
                    <tr><td style="height: 20px;"></td></tr>
                </table>
            </td>
        </tr>
    </table>
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
            to: [{ email_address: { address: "sayantannandi13@gmail.com", name: "Sayantan" } }, { email_address: { address: "nikhilnitro5@gmail.com", name: "Nikhil" } } ],
            subject: "🚀 This week's AI & Tech highlightsL",
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
