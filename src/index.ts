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
<div id=":v1" class="a3s aiL msg-4901284468925022273" role="region" aria-label="Message body"><div style="display:none;max-height:0;overflow:hidden">Anthropic's Agent for Chrome, Nous's Open Hybrid Model, OpenAI updates API, and NotebookLM in 80 languages.</div>



<div lang="und" marginheight="0" marginwidth="0" style="font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;width:100%;padding:0;Margin:0;background-color:#ffffff"><div style="display:none;max-height:0;overflow:hidden">Anthropic's Agent for Chrome, Nous's Open Hybrid Model, OpenAI updates API, and NotebookLM in 80 languages.</div><div style="display:none;font-size:0px;line-height:0px;max-height:0px;max-width:0px;opacity:0;overflow:hidden">{{PreviewText}}&nbsp;</div><table cellpadding="0" cellspacing="0" role="none" style="border-collapse:collapse;border-spacing:0px;padding:0;Margin:0;width:100%;background-repeat:repeat;background-position:center top;height:100%;background-color:#f7fafc" width="100%"><tbody><tr><td class="m_-4901284468925022273es-m-margin" style="padding:0;Margin:0" valign="top"><table align="center" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content" role="none" style="border-collapse:collapse;border-spacing:0px;table-layout:fixed!important;width:100%"><tbody><tr><td align="center" style="padding:0;Margin:0"><table align="center" bgcolor="#00000000" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content-body" role="none" style="border-collapse:collapse;border-spacing:0px;background-color:transparent;width:600px"><tbody><tr><td align="left" style="padding:0;Margin:0"><table cellpadding="0" cellspacing="0" role="none" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td align="center" style="padding:0;Margin:0;width:600px" valign="top"><table cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;border-spacing:0px;border-radius:5px" width="100%"><tbody><tr><td align="right" class="m_-4901284468925022273es-m-txt-c m_-4901284468925022273es-infoblock" style="padding:0;Margin:0;padding-top:5px;padding-bottom:5px;line-height:15.6px;font-size:13px;color:#d3e5f6"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:14.4px;color:#000000;font-size:12px"><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL0hXeVdWbSJ9.Ft-3N2GGYnnx0Dqyo4koGmA-nPL5Sa7LxrcDnb28Ing" style="text-decoration:none;color:#000000;font-size:12px;line-height:14.4px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL0hXeVdWbSJ9.Ft-3N2GGYnnx0Dqyo4koGmA-nPL5Sa7LxrcDnb28Ing&amp;source=gmail&amp;ust=1756734481223000&amp;usg=AOvVaw0qx2OaEDBHqQAB77f8YJpx">Signup</a>&nbsp;&nbsp;|&nbsp;&nbsp;<a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL3FCREp0UCJ9.JRiQfbWxwxXnl9Wlm7p7GSQO99GyTN23RhfVJR4s6GE" style="text-decoration:none;color:#000000;font-size:12px;line-height:14.4px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL3FCREp0UCJ9.JRiQfbWxwxXnl9Wlm7p7GSQO99GyTN23RhfVJR4s6GE&amp;source=gmail&amp;ust=1756734481223000&amp;usg=AOvVaw0DLKhUh4T0FYX6sDGQqoxq">Work With Us</a>&nbsp;&nbsp;|&nbsp;&nbsp;<a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL3VJS0Z0cCJ9.eFD9ODLzQ9DSlrjEKcMyR2n7lNp5EUj7S0RCQsKARvo" style="text-decoration:none;color:#000000;font-size:12px;line-height:14.4px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL3VJS0Z0cCJ9.eFD9ODLzQ9DSlrjEKcMyR2n7lNp5EUj7S0RCQsKARvo&amp;source=gmail&amp;ust=1756734481223000&amp;usg=AOvVaw3p4JZTTjX-keY8rJRqrdU2">Follow on X</a>&nbsp;</p>
</td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table>
<table align="center" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-header" role="none" style="border-collapse:collapse;border-spacing:0px;table-layout:fixed!important;width:100%;background-color:transparent;background-repeat:repeat;background-position:center top"><tbody><tr><td align="center" style="padding:0;Margin:0"><table align="center" bgcolor="#00000000" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-header-body" role="none" style="border-collapse:collapse;border-spacing:0px;background-color:transparent;width:600px"><tbody><tr><td align="left" bgcolor="#2D59F5" style="padding:0;Margin:0;background-color:#2d59f5"><table cellpadding="0" cellspacing="0" role="none" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td align="center" style="padding:0;Margin:0;width:600px" valign="top"><table cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px;border-left:1px solid #000000;border-right:1px solid #000000;border-top:1px solid #000000;border-bottom:1px solid #000000" width="100%"><tbody><tr><td align="left" style="padding:15px;Margin:0;font-size:0px"><img alt="alpha_signal_image_1" src="https://ci3.googleusercontent.com/meips/ADKq_NbCqvtNFGxXjwT7H3n1n1z1Qar5ZCsBdyx2ScYkrmL8WQH33SNzfMMTg9Ro7LemkwvqcWcFwxrQ1DdWCV71Crj5eaf_jCTp7DpmIgMQbzv_Ww_Y1Jrt4_GYHhx5RjyXt6vVM_2lt3417jOCGgEb3RkRAK5_oEOOK0srO4u4e8T6DDLBiMKvdieKYjXrNRXfwaX9HYScECh5oivZ6tuX_fdbUwmyinkojDsyY8R3RX4WL64A5qulkazvdcU=s0-d-e1-ft#https://content.app-us1.com/cdn-cgi/image/width=650,dpr=2,fit=scale-down,format=auto,UNUSED_error=redirect/QMZOW/2024/10/25/5bcd33d4-f684-42c1-a3fa-f5a0d75a8274.png" style="display:block;border:0;outline:none;text-decoration:none" width="30" class="CToWUd" data-bit="iit"></td>
</tr><tr><td style="padding:0;Margin:0"></td></tr><tr><td align="left" style="padding:15px;Margin:0"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:27px;color:#ffffff;font-size:18px"><b>Hey Sayantan Sayantan</b></p></td></tr><tr><td align="left" style="padding:0;Margin:0;padding-bottom:15px;padding-left:15px;padding-right:15px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;color:#ffffff;font-size:16px">Welcome to <span class="il"><span class="il"><span class="il">AlphaSignal</span></span></span>, the most read source of news by AI engineers and researchers. Every day, we identity and summarize the top 1% of news, papers, models, and repos, so you’re always up to date.</p>
<p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;color:#ffffff;font-size:16px"><br></p><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;color:#ffffff;font-size:16px">Here’s today’s roundup:</p></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table>
<table align="center" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content" role="none" style="border-collapse:collapse;border-spacing:0px;table-layout:fixed!important;width:100%"><tbody><tr><td align="center" style="padding:0;Margin:0"><table align="center" bgcolor="#ffffff" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content-body" role="none" style="border-collapse:collapse;border-spacing:0px;background-color:transparent;width:600px"><tbody><tr><td align="left" style="padding:0;Margin:0;padding-left:20px;padding-right:20px"><table cellpadding="0" cellspacing="0" role="none" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td align="center" style="padding:0;Margin:0;width:560px" valign="top"><table cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td align="center" style="padding:10px;Margin:0;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:0px solid #cccccc;background:unset;height:0px;width:100%;margin:0px"></td>
</tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table>
<table align="center" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content" role="none" style="border-collapse:collapse;border-spacing:0px;table-layout:fixed!important;width:100%"><tbody><tr><td align="center" style="padding:0;Margin:0"><table align="center" bgcolor="#ffffff" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content-body" role="none" style="border-collapse:collapse;border-spacing:0px;background-color:transparent;width:600px"><tbody><tr><td align="left" style="padding:0;Margin:0"><table cellpadding="0" cellspacing="0" role="none" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td align="center" style="padding:0;Margin:0;width:600px" valign="top"><table bgcolor="#ffffff" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px;border-left:1px solid #000000;border-right:1px solid #000000;border-top:1px solid #000000;border-bottom:1px solid #000000;background-color:#ffffff" width="100%"><tbody><tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="Margin:0;padding-bottom:10px;padding-top:15px;padding-left:15px;padding-right:20px"><h3 style="Margin:0;line-height:18px;font-family:recursive,sans-serif;font-size:15px;font-style:normal;font-weight:bold;color:#000000">SUMMARY</h3>
</td></tr><tr><td align="center" style="padding:0;Margin:0;padding-bottom:10px;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="95%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:1px solid #000000;background:unset;height:0px;width:100%;margin:0px"></td></tr></tbody></table></td></tr><tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="padding:0;Margin:0;padding-left:15px;padding-right:20px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:19.5px;color:#000000;font-size:13px">Read time: 4 min 28 sec</p></td></tr>
<tr><td align="center" style="padding:0;Margin:0;padding-top:10px;padding-bottom:20px;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="95%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:1px solid #dadada;background:unset;height:0px;width:100%;margin:0px"></td></tr></tbody></table></td></tr><tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="padding:0;Margin:0;padding-left:15px;padding-right:20px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;color:#000000;font-size:16px"><strong>Top News</strong></p></td></tr>
<tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="Margin:0;padding-top:10px;padding-bottom:10px;padding-right:15px;padding-left:20px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px"><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpLzlMbk1SRCJ9.QilJ92gDrWAlhYDnW45LxRy8IfZFKBgC-W-mO-QZv_E" style="text-decoration:none;color:#000000;font-size:15px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpLzlMbk1SRCJ9.QilJ92gDrWAlhYDnW45LxRy8IfZFKBgC-W-mO-QZv_E&amp;source=gmail&amp;ust=1756734481223000&amp;usg=AOvVaw3NwmZevWNrfskI4SOaWE98"><img data-emoji="▪" class="an1" alt="▪" aria-label="▪" draggable="false" src="https://fonts.gstatic.com/s/e/notoemoji/16.0/25aa/72.png" loading="lazy"> Google ships Gemini 2.5 Flash Image <span style="color:#2660f5">(nano-banana) image editor</span></a></p></td></tr>
<tr><td align="center" style="padding:0;Margin:0;padding-top:10px;padding-bottom:20px;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="95%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:1px solid #dadada;background:unset;height:0px;width:100%;margin:0px"></td></tr></tbody></table></td></tr><tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="padding:0;Margin:0;padding-left:15px;padding-right:20px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;color:#000000;font-size:16px"><b>Encord</b></p></td></tr>
<tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="Margin:0;padding-top:5px;padding-bottom:15px;padding-right:15px;padding-left:20px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px"><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL2YzcGZncCJ9.A7arDfbeFbNcusl08-EEqrSGfES5wLYexCmfj-ilOdU" style="text-decoration:none;color:#000000;font-size:15px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL2YzcGZncCJ9.A7arDfbeFbNcusl08-EEqrSGfES5wLYexCmfj-ilOdU&amp;source=gmail&amp;ust=1756734481223000&amp;usg=AOvVaw2oJsV1c_PCjd5n0qyyNaSY"><img data-emoji="▪" class="an1" alt="▪" aria-label="▪" draggable="false" src="https://fonts.gstatic.com/s/e/notoemoji/16.0/25aa/72.png" loading="lazy"></a> <a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL0JlMkJXRSJ9.Ws1s9hrrzURlcF_lc0t4v_s-_D3HRuFNdFdbE0K5-1I" style="text-decoration:none;color:#000000;font-size:15px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL0JlMkJXRSJ9.Ws1s9hrrzURlcF_lc0t4v_s-_D3HRuFNdFdbE0K5-1I&amp;source=gmail&amp;ust=1756734481223000&amp;usg=AOvVaw2tkbTVVC3xaQCXXgSX337u">Join tomorrow: SwingVision and Encord show <span style="color:#2660f5">how to scale AI</span></a></p></td></tr>
<tr><td align="center" style="padding:0;Margin:0;padding-top:10px;padding-bottom:20px;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="95%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:1px solid #dadada;background:unset;height:0px;width:100%;margin:0px"></td></tr></tbody></table></td></tr><tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="padding:0;Margin:0;padding-left:15px;padding-right:20px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;color:#000000;font-size:16px"><strong>Trending Signals</strong></p></td></tr>
<tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="Margin:0;padding-top:10px;padding-bottom:10px;padding-right:15px;padding-left:20px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px"><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL0xRMEFBZCJ9.4lbDeNnJ96VHlDO05pBWi77zJPruo7at9qF2NpwUZxk" style="text-decoration:none;color:#000000;font-size:15px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL0xRMEFBZCJ9.4lbDeNnJ96VHlDO05pBWi77zJPruo7at9qF2NpwUZxk&amp;source=gmail&amp;ust=1756734481223000&amp;usg=AOvVaw1TzmsbaXigw6k-MLj_72LC"><img data-emoji="▪" class="an1" alt="▪" aria-label="▪" draggable="false" src="https://fonts.gstatic.com/s/e/notoemoji/16.0/25aa/72.png" loading="lazy"> Anthropic puts <span style="color:#2660f5">Claude AI agent directly into Google Chrome</span></a></p></td></tr>
<tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="Margin:0;padding-top:10px;padding-bottom:10px;padding-right:15px;padding-left:20px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px"><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL2ZWR25pQyJ9.psv6W3tY8yzaKwq-_UoKR2_lz68TmliLphJ0BKEQR_A" style="text-decoration:none;color:#000000;font-size:15px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL2ZWR25pQyJ9.psv6W3tY8yzaKwq-_UoKR2_lz68TmliLphJ0BKEQR_A&amp;source=gmail&amp;ust=1756734481223000&amp;usg=AOvVaw1DvMtaYd66w6tvq2jnMF2I"><img data-emoji="▪" class="an1" alt="▪" aria-label="▪" draggable="false" src="https://fonts.gstatic.com/s/e/notoemoji/16.0/25aa/72.png" loading="lazy"> Nous Research debuts its <span style="color:#2660f5">open-source hybrid reasoning model family</span></a></p></td></tr>
<tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="Margin:0;padding-top:10px;padding-bottom:10px;padding-right:15px;padding-left:20px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px"><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL0RhbkMyeiJ9.kj2qKObrlZS5EE5d-1bD3AzJ42Yx9fRq7f6XQdLlazE" style="text-decoration:none;color:#000000;font-size:15px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL0RhbkMyeiJ9.kj2qKObrlZS5EE5d-1bD3AzJ42Yx9fRq7f6XQdLlazE&amp;source=gmail&amp;ust=1756734481223000&amp;usg=AOvVaw0oJIdMscaPR-dADdkwKLdN"><img data-emoji="▪" class="an1" alt="▪" aria-label="▪" draggable="false" src="https://fonts.gstatic.com/s/e/notoemoji/16.0/25aa/72.png" loading="lazy"> Anthropic makes <span style="color:#2660f5">Claude Code GitHub integration GA</span> with API and templates</a></p></td></tr>
<tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="Margin:0;padding-top:10px;padding-bottom:10px;padding-right:15px;padding-left:20px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px"><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpLzRLM3lTQSJ9.XDzKlST4MOsw1OO0HUgO85m9DuxWfRR71_sMbs6ZeHw" style="text-decoration:none;color:#000000;font-size:15px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpLzRLM3lTQSJ9.XDzKlST4MOsw1OO0HUgO85m9DuxWfRR71_sMbs6ZeHw&amp;source=gmail&amp;ust=1756734481223000&amp;usg=AOvVaw2B7erCFWfxmqW8tgXNPDn8"><img data-emoji="▪" class="an1" alt="▪" aria-label="▪" draggable="false" src="https://fonts.gstatic.com/s/e/notoemoji/16.0/25aa/72.png" loading="lazy"> <span style="color:#2660f5">OpenAI moves Assistants features</span> into the Responses API with reasoning</a></p></td></tr>
<tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="Margin:0;padding-top:10px;padding-bottom:10px;padding-right:15px;padding-left:20px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px"><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL000ZjJsdiJ9.jgh5Uz6NY6Ak3du3W5gcgbEts_Kjz4TFSVlLX1hIwWo" style="text-decoration:none;color:#000000;font-size:15px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL000ZjJsdiJ9.jgh5Uz6NY6Ak3du3W5gcgbEts_Kjz4TFSVlLX1hIwWo&amp;source=gmail&amp;ust=1756734481223000&amp;usg=AOvVaw1fsFPYHPsXHvSq0tSGocH9"><img data-emoji="▪" class="an1" alt="▪" aria-label="▪" draggable="false" src="https://fonts.gstatic.com/s/e/notoemoji/16.0/25aa/72.png" loading="lazy"> Google's NotebookLM now supports <span style="color:#2660f5">Video and Audio Overviews in 80 language</span>s</a></p></td></tr>
<tr><td align="center" style="padding:0;Margin:0;padding-top:10px;padding-bottom:20px;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="95%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:1px solid #dadada;background:unset;height:0px;width:100%;margin:0px"></td></tr></tbody></table></td></tr><tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="padding:0;Margin:0;padding-left:15px;padding-right:20px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;color:#000000;font-size:16px"><strong>Top Papers</strong></p></td></tr>
<tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="Margin:0;padding-top:10px;padding-bottom:10px;padding-right:15px;padding-left:20px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px"><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL3k1a1lrMCJ9.zK_gH1hZi4QQ08dTTcuPvTS8CtxQ4tldCApn3k5KLuU" style="text-decoration:none;color:#100f0f;font-size:15px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL3k1a1lrMCJ9.zK_gH1hZi4QQ08dTTcuPvTS8CtxQ4tldCApn3k5KLuU&amp;source=gmail&amp;ust=1756734481224000&amp;usg=AOvVaw2urktqdlvlCGHfJy6vbkdJ"><img data-emoji="▪" class="an1" alt="▪" aria-label="▪" draggable="false" src="https://fonts.gstatic.com/s/e/notoemoji/16.0/25aa/72.png" loading="lazy"> Stanford study finds <span style="color:#2660f5">13% decline in AI-exposed entry-level jobs</span></a></p></td></tr>
<tr><td align="left" class="m_-4901284468925022273es-m-txt-l" href="https://link.alphasignal.ai/It7Tgk" style="Margin:0;padding-top:10px;padding-bottom:10px;padding-right:15px;padding-left:20px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px"><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL3NCeTVjbyJ9.9W2-LlFz4FYXQQuByz8Dm6nQF62j-wArkGul0dqFuks" style="text-decoration:none;color:#000000;font-size:15px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL3NCeTVjbyJ9.9W2-LlFz4FYXQQuByz8Dm6nQF62j-wArkGul0dqFuks&amp;source=gmail&amp;ust=1756734481224000&amp;usg=AOvVaw1lt1-pj6lNgnNhhOBxE4HI"><img data-emoji="▪" class="an1" alt="▪" aria-label="▪" draggable="false" src="https://fonts.gstatic.com/s/e/notoemoji/16.0/25aa/72.png" loading="lazy"> LLM agents <span style="color:#2660f5">learn from past tasks, not from gradients</span> or retraining</a></p></td></tr>
<tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="Margin:0;padding-top:10px;padding-bottom:10px;padding-right:15px;padding-left:20px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px"><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpLzJra2ptciJ9.Qk3Zdao5-AXY6L02v1Oe6gZZ8QQS_ZcFIAQFB69yW1o" style="text-decoration:none;color:#000000;font-size:15px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpLzJra2ptciJ9.Qk3Zdao5-AXY6L02v1Oe6gZZ8QQS_ZcFIAQFB69yW1o&amp;source=gmail&amp;ust=1756734481224000&amp;usg=AOvVaw3uhl-iC-8GGtQZFNp1oH4T"><img data-emoji="▪" class="an1" alt="▪" aria-label="▪" draggable="false" src="https://fonts.gstatic.com/s/e/notoemoji/16.0/25aa/72.png" loading="lazy"> Google trains <span style="color:#2660f5">LLMs to predict system metrics </span>without tabular data</a></p></td></tr>
<tr><td align="center" style="padding:0;Margin:0;padding-top:10px;padding-bottom:20px;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="95%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:1px solid #dadada;background:unset;height:0px;width:100%;margin:0px"></td></tr></tbody></table></td></tr><tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="padding:0;Margin:0;padding-left:15px;padding-right:20px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;color:#000000;font-size:16px"><b>Product Deep Dive</b></p></td></tr>
<tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="Margin:0;padding-top:5px;padding-bottom:15px;padding-right:15px;padding-left:20px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px"><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL2YzcGZncCJ9.A7arDfbeFbNcusl08-EEqrSGfES5wLYexCmfj-ilOdU" style="text-decoration:none;color:#000000;font-size:15px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL2YzcGZncCJ9.A7arDfbeFbNcusl08-EEqrSGfES5wLYexCmfj-ilOdU&amp;source=gmail&amp;ust=1756734481224000&amp;usg=AOvVaw3nuT42rOSJ8K6GL3JTJj9-"><img data-emoji="▪" class="an1" alt="▪" aria-label="▪" draggable="false" src="https://fonts.gstatic.com/s/e/notoemoji/16.0/25aa/72.png" loading="lazy"></a> <a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL3FFR2VXdiJ9.nReWSsu6mQ3_00VWiHsCtFySL9t28zqd0F5e9IkH35I" style="text-decoration:none;color:#000000;font-size:15px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL3FFR2VXdiJ9.nReWSsu6mQ3_00VWiHsCtFySL9t28zqd0F5e9IkH35I&amp;source=gmail&amp;ust=1756734481224000&amp;usg=AOvVaw2ilrpXmYio8DaZZhBojQ4N"><span style="color:#2660f5">How Google built Nano-Banana</span>: Smart, multistep image generation</a></p></td></tr></tbody></table></td></tr></tbody></table></td></tr>
</tbody></table></td></tr></tbody></table>
<table align="center" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content" role="none" style="border-collapse:collapse;border-spacing:0px;table-layout:fixed!important;width:100%"><tbody><tr><td align="center" style="padding:0;Margin:0"><table align="center" bgcolor="#ffffff" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content-body" role="none" style="border-collapse:collapse;border-spacing:0px;background-color:transparent;width:600px"><tbody><tr><td align="left" style="padding:0;Margin:0;padding-left:20px;padding-right:20px"><table cellpadding="0" cellspacing="0" role="none" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td align="center" style="padding:0;Margin:0;width:560px" valign="top"><table cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td align="center" style="padding:15px;Margin:0;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:0px solid #cccccc;background:unset;height:0px;width:100%;margin:0px"></td>
</tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table>
<table align="center" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content" role="none" style="border-collapse:collapse;border-spacing:0px;table-layout:fixed!important;width:100%"><tbody><tr><td align="center" style="padding:0;Margin:0"><table align="center" bgcolor="#ffffff" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content-body" role="none" style="border-collapse:collapse;border-spacing:0px;background-color:transparent;width:600px"><tbody><tr><td align="left" style="padding:0;Margin:0"><table cellpadding="0" cellspacing="0" role="none" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td align="center" style="padding:0;Margin:0;width:600px" valign="top"><table bgcolor="#ffffff" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px;border-left:1px solid #000000;border-right:1px solid #000000;border-top:1px solid #000000;border-bottom:1px solid #000000;background-color:#ffffff" width="100%"><tbody><tr><td align="center" class="m_-4901284468925022273es-m-txt-c" style="padding:15px;Margin:0"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;color:#000000;font-size:16px"><strong>If you're enjoying <span class="il"><span class="il"><span class="il">AlphaSignal</span></span></span> please forward this email to a colleague.&nbsp;</strong></p>
<p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;color:#000000;font-size:16px">It helps us keep this content free.</p></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table>
<table align="center" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content" role="none" style="border-collapse:collapse;border-spacing:0px;table-layout:fixed!important;width:100%"><tbody><tr><td align="center" style="padding:0;Margin:0"><table align="center" bgcolor="#ffffff" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content-body" role="none" style="border-collapse:collapse;border-spacing:0px;background-color:transparent;width:600px"><tbody><tr><td align="left" style="padding:0;Margin:0;padding-left:20px;padding-right:20px"><table cellpadding="0" cellspacing="0" role="none" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td align="center" style="padding:0;Margin:0;width:560px" valign="top"><table cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td align="center" style="padding:15px;Margin:0;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:0px solid #cccccc;background:unset;height:0px;width:100%;margin:0px"></td>
</tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table>
<table align="center" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content" role="none" style="border-collapse:collapse;border-spacing:0px;table-layout:fixed!important;width:100%"><tbody><tr><td align="center" style="padding:0;Margin:0"><table align="center" bgcolor="#ffffff" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content-body" role="none" style="border-collapse:collapse;border-spacing:0px;background-color:transparent;width:600px"><tbody><tr><td align="left" style="padding:0;Margin:0"><table cellpadding="0" cellspacing="0" role="none" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td align="center" style="padding:0;Margin:0;width:600px" valign="top"><table bgcolor="#FFFFFF" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px;border-left:1px solid #000000;border-right:1px solid #000000;border-top:1px solid #000000;border-bottom:1px solid #000000;background-color:#ffffff" width="100%"><tbody><tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="Margin:0;padding-bottom:10px;padding-top:15px;padding-left:15px;padding-right:20px"><h3 style="Margin:0;line-height:18px;font-family:recursive,sans-serif;font-size:15px;font-style:normal;font-weight:bold;color:#000000">TOP_NEWS</h3>
</td></tr><tr><td align="center" style="padding:0;Margin:0;padding-bottom:20px;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="95%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:1px solid #000000;background:unset;height:0px;width:100%;margin:0px"></td></tr></tbody></table></td></tr><tr><td align="left" style="padding:0;Margin:0;padding-bottom:5px;padding-left:20px;padding-right:20px"><h2 style="Margin:0;line-height:20.4px;font-family:'ibm plex sans',sans-serif;font-size:17px;font-style:normal;font-weight:bold;color:#000000">Google's Gemini 2.5 Flash Image ranks #1 on LM Arena for image editing, beating OpenAI and Flux</h2>
<p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;color:#000000;font-size:16px;display:none"><br></p></td></tr><tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="padding:0;Margin:0;padding-left:20px;padding-right:20px"><p style="Margin:0;font-family:recursive,sans-serif;line-height:19.5px;color:#2d59f5;font-size:13px">60,386 Likes</p></td></tr>
<tr><td align="center" style="padding:0;Margin:0;padding-top:10px;font-size:0px"><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpLzlMbk1SRCJ9.QilJ92gDrWAlhYDnW45LxRy8IfZFKBgC-W-mO-QZv_E" style="text-decoration:none;color:#000000;font-size:16px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpLzlMbk1SRCJ9.QilJ92gDrWAlhYDnW45LxRy8IfZFKBgC-W-mO-QZv_E&amp;source=gmail&amp;ust=1756734481224000&amp;usg=AOvVaw17FUEHk-LNtSyqYezkmCVp"><img alt="alpha_signal_image_2" class="m_-4901284468925022273adapt-img CToWUd" src="https://ci3.googleusercontent.com/meips/ADKq_NafTsew1T7KzgrMqesqRpj6t7iqi0bugWVVkTf-dYyk7GcMAEN-25-m95vPptzee08bzplhgK7Mb04AE03BeKJTjzrMzJrWVyNNQyGiOrtrS0JcSKV9nyX0PyG4zdaEwjPSWoohDOfzBtHroPKcnO-P0jNymYuZPfD5Rk551vzjfupmaHv_eOvSecdvxXEWJQgGDNSgqCdoDHJEaMkcaUtiutCrMHGc07uarbXG3OouXk7SBmvLRaiJaak=s0-d-e1-ft#https://content.app-us1.com/cdn-cgi/image/width=650,dpr=2,fit=scale-down,format=auto,UNUSED_error=redirect/QMZOW/2025/08/27/c3f56811-e804-4c22-b9c0-0a3d37f965df.gif" style="display:block;border:0;outline:none;text-decoration:none" width="564" data-bit="iit"></a>
</td></tr><tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="padding:0;Margin:0;padding-top:20px;padding-left:20px;padding-right:20px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Google released <strong>Gemini 2.5 Flash Image</strong> (internally known as <em>nano-banana</em>), its new SOTA image generation and editing model. It supports multi-step image editing, character consistency, and world-knowledge-based transformations, all controlled through natural language prompts.</p><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px"><br></p>
<p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">This means a single model can now handle complex editing workflows, from template-driven automation to character-consistent storytelling and product design.</p><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px"><br></p><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px"><strong>Key Features</strong></p><ul>
<li style="font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;margin-left:0;color:#000000;font-size:16px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Supports <strong>multi-turn edits</strong> while keeping results consistent.</p></li>
<li style="font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;margin-left:0;color:#000000;font-size:16px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Maintains <strong>character likeness</strong> across scenes and edits.</p></li>
<li style="font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;margin-left:0;color:#000000;font-size:16px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Enables <strong>precise local edits</strong> with natural language like, blur, remove, recolor.</p></li>
<li style="font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;margin-left:0;color:#000000;font-size:16px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Performs <strong>multi-image fusion</strong> for blending objects or scenes.</p></li>
<li style="font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;margin-left:0;color:#000000;font-size:16px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Uses <strong>Gemini’s world knowledge</strong> to make contextually accurate edits like adding correct plants to a scene.</p></li>
<li style="font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;margin-left:0;color:#000000;font-size:16px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Adds <strong>SynthID watermarking</strong> to all generated or edited images.</p></li> </ul><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px"><strong>Performance</strong></p><ul>
<li style="font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;margin-left:0;color:#000000;font-size:16px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Ranked #1 on LM Arena’s Image Edit leaderboard, surpassing Flux-Kontext (No. 2) by a wide margin.</p></li>
<li style="font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;margin-left:0;color:#000000;font-size:16px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Outperformed competing models such as <strong style="text-align:center">OpenAI’s gpt-image</strong> and <strong style="text-align:center">BFL’s Flux-Kontext</strong> on cost-to-performance ratio.</p></li> </ul><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px"><b>Pricing and Cost Controls</b></p><ul>
<li style="font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;margin-left:0;color:#000000;font-size:16px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Priced at $30 per 1M output tokens.</p></li>
<li style="font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;margin-left:0;color:#000000;font-size:16px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Each image equals 1,290 output tokens (~$0.039 per image).</p></li>
<li style="font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;margin-left:0;color:#000000;font-size:16px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Slightly cheaper than comparable models like OpenAI’s gpt-image and BFL’s Flux-Kontext.</p></li>
<li style="font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;margin-left:0;color:#000000;font-size:16px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Input/output for text still follows Gemini 2.5 Flash pricing.</p></li> </ul><h3 style="Margin:0;line-height:18px;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;font-size:15px;font-style:normal;font-weight:bold;color:#000000">Availability</h3><ul>
<li style="font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;margin-left:0;color:#000000;font-size:16px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Available now via the <strong>Gemini API</strong> and <strong>Google AI Studio</strong> (preview).</p></li>
<li style="font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;margin-left:0;color:#000000;font-size:16px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Enterprise access through <strong>Vertex AI</strong>.</p></li>
<li style="font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;margin-left:0;color:#000000;font-size:16px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Integrated into <strong>Google AI Studio’s Build Mode</strong> for prototyping and remixing apps with minimal code.</p></li>
<li style="font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;margin-left:0;color:#000000;font-size:16px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Also available through <strong>OpenRouter.ai</strong> and <strong><a href="http://fal.ai" target="_blank" data-saferedirecturl="https://www.google.com/url?q=http://fal.ai&amp;source=gmail&amp;ust=1756734481224000&amp;usg=AOvVaw3BzTdXbZZF6VF-x9D2erjK">fal.ai</a></strong> developer platform.</p></li> </ul></td></tr><tr><td align="left" style="padding:0;Margin:0;padding-left:20px;padding-right:20px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;color:#000000;font-size:16px"><strong></strong><strong></strong></p></td></tr>
<tr><td align="center" class="m_-4901284468925022273es-m-txt-c" style="padding:0;Margin:0;padding-left:10px;padding-right:10px;padding-bottom:15px"><span class="m_-4901284468925022273es-button-border" style="border-style:solid;border-color:transparent;background:#2d59f5;border-width:0px;display:inline-block;border-radius:0px;width:auto"><a class="m_-4901284468925022273es-button" href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpLzlMbk1SRCJ9.QilJ92gDrWAlhYDnW45LxRy8IfZFKBgC-W-mO-QZv_E" style="text-decoration:none;color:#ffffff;font-size:16px;display:inline-block;background:#2d59f5;border-radius:0px;font-family:arial,'helvetica neue',helvetica,sans-serif;font-weight:bold;font-style:normal;line-height:19.2px;width:auto;text-align:center;padding:15px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpLzlMbk1SRCJ9.QilJ92gDrWAlhYDnW45LxRy8IfZFKBgC-W-mO-QZv_E&amp;source=gmail&amp;ust=1756734481224000&amp;usg=AOvVaw17FUEHk-LNtSyqYezkmCVp">TRY NOW</a>
</span></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table>
<table align="center" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content" role="none" style="border-collapse:collapse;border-spacing:0px;table-layout:fixed!important;width:100%"><tbody><tr><td align="center" style="padding:0;Margin:0"><table align="center" bgcolor="#ffffff" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content-body" role="none" style="border-collapse:collapse;border-spacing:0px;background-color:transparent;width:600px"><tbody><tr><td align="left" style="padding:0;Margin:0;padding-left:20px;padding-right:20px"><table cellpadding="0" cellspacing="0" role="none" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td align="center" style="padding:0;Margin:0;width:560px" valign="top"><table cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td align="center" style="padding:15px;Margin:0;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:0px solid #cccccc;background:unset;height:0px;width:100%;margin:0px"></td>
</tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table>
<table align="center" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content" role="none" style="border-collapse:collapse;border-spacing:0px;table-layout:fixed!important;width:100%"><tbody><tr><td align="center" style="padding:0;Margin:0"><table align="center" bgcolor="#ffffff" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content-body" role="none" style="border-collapse:collapse;border-spacing:0px;background-color:transparent;width:600px"><tbody><tr><td align="left" style="padding:0;Margin:0"><table cellpadding="0" cellspacing="0" role="none" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td align="center" style="padding:0;Margin:0;border-radius:5px;overflow:hidden;width:600px" valign="top"><table bgcolor="#ffffff" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;border-spacing:0px;border-left:1px dotted #000000;border-right:1px dotted #000000;border-top:1px dotted #000000;border-bottom:1px dotted #000000;background-color:#ffffff;border-radius:5px" width="100%"><tbody><tr><td align="center" style="Margin:0;padding-left:10px;padding-right:10px;padding-top:20px;padding-bottom:20px;font-size:0px"><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL0JlMkJXRSJ9.Ws1s9hrrzURlcF_lc0t4v_s-_D3HRuFNdFdbE0K5-1I" style="text-decoration:none;color:#000000;font-size:16px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL0JlMkJXRSJ9.Ws1s9hrrzURlcF_lc0t4v_s-_D3HRuFNdFdbE0K5-1I&amp;source=gmail&amp;ust=1756734481224000&amp;usg=AOvVaw2H9mQQLiS7edSmwLdpaAbd"><img alt="alpha_signal_image_3" class="m_-4901284468925022273adapt-img CToWUd" src="https://ci3.googleusercontent.com/meips/ADKq_NYHZ9_GEZ5273ZKCChLw2020Y1BG0ZtvqIK0eOR8-NGhvD5INGfC7UT6XBufDh4zOG1giJ580STGcDiWZrZxpJ6UpXSy8xprWQ0nTl4Z7t_U5Lh3eoh19QpsUW0yAGrrt8__fjHOAEiKLxcJYnb_9sC7JdB4XnMS6YbZq-9_HQLLlhylIvpUv_EYZymBqrHRdpPFNDNoEXN_E7o5A0g8KPgHpxddlVz1J2o2WSh2sji0nl__ZjzJzdchJJV=s0-d-e1-ft#https://content.app-us1.com/cdn-cgi/image/width=650,dpr=2,fit=scale-down,format=auto,UNUSED_error=redirect/QMZOW/2025/08/27/ad1cd07a-23db-435a-a4ff-d5bb7d4b0e25.jpeg" style="display:block;border:0;outline:none;text-decoration:none" width="564" data-bit="iit"></a>
</td></tr><tr><td align="left" style="Margin:0;padding-top:10px;padding-bottom:20px;padding-left:20px;padding-right:20px"><h2 style="Margin:0;line-height:20.4px;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;font-size:17px;font-style:normal;font-weight:bold;color:#000000">Happening Tomorrow: Boost Production AI Iteration by 30% &amp; Cut Infra Debt</h2></td></tr>
<tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="padding:0;Margin:0;padding-left:20px;padding-right:20px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Join Encord’s upcoming webinar and get a comprehensive framework for how SwingVision scaled real-time computer vision with minimal overhead. Walk away with actionable ways to slash technical debt and raise model velocity, without overbuilding.</p><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px"><br></p>
<p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">See how you can:</p><ul> <li style="font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;margin-left:0;color:#000000;font-size:16px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Architect a stack that enables faster iteration cycles<br><br></p></li>
<li style="font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;margin-left:0;color:#000000;font-size:16px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Identify edge cases early and maintain model accuracy<br><br></p></li>
<li style="font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;margin-left:0;color:#000000;font-size:16px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Optimize engineering effort to focus on high-impact features<br><br></p></li>
<li style="font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;margin-left:0;color:#000000;font-size:16px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Reduce time-to-market by choosing where to build vs. integrate<br></p></li> </ul><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Join to see how top teams avoid common traps and move faster.</p></td></tr>
<tr><td align="center" class="m_-4901284468925022273es-m-txt-c" style="padding:10px;Margin:0"><span class="m_-4901284468925022273es-button-border" style="border-style:solid;border-color:transparent;background:#2d59f5;border-width:0px;display:inline-block;border-radius:5px;width:auto"><a class="m_-4901284468925022273es-button" href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL0JlMkJXRSJ9.Ws1s9hrrzURlcF_lc0t4v_s-_D3HRuFNdFdbE0K5-1I" style="text-decoration:none;color:#ffffff;font-size:16px;display:inline-block;background:#2d59f5;border-radius:5px;font-family:arial,'helvetica neue',helvetica,sans-serif;font-weight:bold;font-style:normal;line-height:19.2px;width:auto;text-align:center;padding:10px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL0JlMkJXRSJ9.Ws1s9hrrzURlcF_lc0t4v_s-_D3HRuFNdFdbE0K5-1I&amp;source=gmail&amp;ust=1756734481224000&amp;usg=AOvVaw2H9mQQLiS7edSmwLdpaAbd">SAVE YOUR SPOT</a>
</span></td></tr><tr><td align="right" class="m_-4901284468925022273es-m-txt-r" style="padding:0;Margin:0;padding-bottom:5px;padding-left:10px;padding-right:10px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:19.5px;color:#000000;font-size:13px"><em><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL3FCREp0UCJ9.JRiQfbWxwxXnl9Wlm7p7GSQO99GyTN23RhfVJR4s6GE" style="text-decoration:none;color:#000000;font-size:13px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL3FCREp0UCJ9.JRiQfbWxwxXnl9Wlm7p7GSQO99GyTN23RhfVJR4s6GE&amp;source=gmail&amp;ust=1756734481224000&amp;usg=AOvVaw0cttVueHsc1VHdVXxjbugU">partner with us</a></em></p></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table>
<table align="center" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content" role="none" style="border-collapse:collapse;border-spacing:0px;table-layout:fixed!important;width:100%"><tbody><tr><td align="center" style="padding:0;Margin:0"><table align="center" bgcolor="#ffffff" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content-body" role="none" style="border-collapse:collapse;border-spacing:0px;background-color:transparent;width:600px"><tbody><tr><td align="left" style="padding:0;Margin:0;padding-left:20px;padding-right:20px"><table cellpadding="0" cellspacing="0" role="none" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td align="center" style="padding:0;Margin:0;width:560px" valign="top"><table cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td align="center" style="padding:15px;Margin:0;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:0px solid #cccccc;background:unset;height:0px;width:100%;margin:0px"></td>
</tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table>
<table align="center" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content" role="none" style="border-collapse:collapse;border-spacing:0px;table-layout:fixed!important;width:100%"><tbody><tr><td align="center" style="padding:0;Margin:0"><table align="center" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content-body" role="none" style="border-collapse:collapse;border-spacing:0px;background-color:transparent;width:600px"><tbody><tr><td align="left" style="padding:0;Margin:0"><table cellpadding="0" cellspacing="0" role="none" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td align="center" style="padding:0;Margin:0;width:600px" valign="top"><table bgcolor="#FFFFFF" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px;border-left:1px solid #000000;border-right:1px solid #000000;border-top:1px solid #000000;border-bottom:1px solid #000000;background-color:#ffffff" width="100%"><tbody><tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="Margin:0;padding-bottom:10px;padding-top:15px;padding-left:20px;padding-right:20px"><h3 style="Margin:0;line-height:18px;font-family:recursive,sans-serif;font-size:15px;font-style:normal;font-weight:bold;color:#000000">TOP_SIGNALS</h3>
</td></tr><tr><td align="center" style="padding:0;Margin:0;padding-bottom:20px;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="95%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:1px solid #000000;background:unset;height:0px;width:100%;margin:0px"></td></tr></tbody></table></td></tr>
<tr><td align="left" style="Margin:0;padding-top:5px;padding-bottom:5px;padding-left:20px;padding-right:20px"><h2 style="Margin:0;line-height:20.4px;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;font-size:17px;font-style:normal;font-weight:bold;color:#000000"><strong><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL0xRMEFBZCJ9.4lbDeNnJ96VHlDO05pBWi77zJPruo7at9qF2NpwUZxk" style="text-decoration:none;color:#000000;font-size:17px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL0xRMEFBZCJ9.4lbDeNnJ96VHlDO05pBWi77zJPruo7at9qF2NpwUZxk&amp;source=gmail&amp;ust=1756734481224000&amp;usg=AOvVaw3g0_KxprW6Cb40g9TQHSao">Anthropic debuts Claude for Chrome, enabling Claude to browse, click, and fill forms in-browser</a></strong></h2></td></tr>
<tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="padding:0;Margin:0;padding-left:20px;padding-right:20px"><p style="Margin:0;font-family:recursive,sans-serif;line-height:19.5px;color:#2d59f5;font-size:13px">6,826 Likes</p></td></tr><tr><td align="center" style="Margin:0;padding-left:10px;padding-right:10px;padding-top:15px;padding-bottom:15px;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="95%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:1px solid #cccccc;background:unset;height:0px;width:100%;margin:0px"></td></tr></tbody></table></td></tr>
<tr><td align="left" style="Margin:0;padding-top:5px;padding-bottom:5px;padding-left:20px;padding-right:20px"><h2 style="Margin:0;line-height:20.4px;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;font-size:17px;font-style:normal;font-weight:bold;color:#000000"><strong><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL2ZWR25pQyJ9.psv6W3tY8yzaKwq-_UoKR2_lz68TmliLphJ0BKEQR_A" style="text-decoration:none;color:#000000;font-size:17px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL2ZWR25pQyJ9.psv6W3tY8yzaKwq-_UoKR2_lz68TmliLphJ0BKEQR_A&amp;source=gmail&amp;ust=1756734481224000&amp;usg=AOvVaw2d1klnTt2_F64hARDQZDy9">Nous Research unveils Hermes 4, open-source hybrid reasoning models with strong math, coding, reasoning</a></strong></h2></td></tr>
<tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="padding:0;Margin:0;padding-left:20px;padding-right:20px"><p style="Margin:0;font-family:recursive,sans-serif;line-height:19.5px;color:#2d59f5;font-size:13px">1,583 Likes</p></td></tr><tr><td align="center" style="Margin:0;padding-left:10px;padding-right:10px;padding-top:15px;padding-bottom:15px;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="95%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:1px solid #cccccc;background:unset;height:0px;width:100%;margin:0px"></td></tr></tbody></table></td></tr>
<tr><td align="left" style="Margin:0;padding-top:5px;padding-bottom:5px;padding-left:20px;padding-right:20px"><h2 style="Margin:0;line-height:20.4px;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;font-size:17px;font-style:normal;font-weight:bold;color:#000000"><strong><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL0RhbkMyeiJ9.kj2qKObrlZS5EE5d-1bD3AzJ42Yx9fRq7f6XQdLlazE" style="text-decoration:none;color:#000000;font-size:17px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL0RhbkMyeiJ9.kj2qKObrlZS5EE5d-1bD3AzJ42Yx9fRq7f6XQdLlazE&amp;source=gmail&amp;ust=1756734481224000&amp;usg=AOvVaw3jUzF1FBwnqGAcU9kDQFhS">Anthropic ships Claude Code GitHub integration GA, allowing you to use templates and subagents for automation</a></strong></h2></td></tr>
<tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="padding:0;Margin:0;padding-left:20px;padding-right:20px"><p style="Margin:0;font-family:recursive,sans-serif;line-height:19.5px;color:#2d59f5;font-size:13px">2,258 Likes</p></td></tr><tr><td align="center" style="Margin:0;padding-left:10px;padding-right:10px;padding-top:15px;padding-bottom:15px;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="95%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:1px solid #cccccc;background:unset;height:0px;width:100%;margin:0px"></td></tr></tbody></table></td></tr>
<tr><td align="left" style="Margin:0;padding-top:5px;padding-bottom:5px;padding-left:20px;padding-right:20px"><h3 style="Margin:0;line-height:21.6px;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;font-size:18px;font-style:normal;font-weight:bold;color:#000000;text-align:left"><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiIn0.UmxdER4Kvxno6s_N4mTwutsk9oNFCP-9no0LbmdfzGs" style="text-decoration:none;color:#000000;font-size:18px;text-align:left" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiIn0.UmxdER4Kvxno6s_N4mTwutsk9oNFCP-9no0LbmdfzGs&amp;source=gmail&amp;ust=1756734481224000&amp;usg=AOvVaw37pyV0CsYBaS4SsHSczvNW"></a></h3>
<h2 style="Margin:0;line-height:20.4px;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;font-size:17px;font-style:normal;font-weight:bold;color:#000000"><strong><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpLzRLM3lTQSJ9.XDzKlST4MOsw1OO0HUgO85m9DuxWfRR71_sMbs6ZeHw" style="text-decoration:none;color:#000000;font-size:17px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpLzRLM3lTQSJ9.XDzKlST4MOsw1OO0HUgO85m9DuxWfRR71_sMbs6ZeHw&amp;source=gmail&amp;ust=1756734481224000&amp;usg=AOvVaw2c1bHR9TlMWs5lwYck1sEN">OpenAI recommends developers migrate from Assistants API as Responses API surpasses Chat Completions in token activity</a></strong></h2></td></tr><tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="padding:0;Margin:0;padding-left:20px;padding-right:20px"><p style="Margin:0;font-family:recursive,sans-serif;line-height:19.5px;color:#2d59f5;font-size:13px">664 Likes</p></td></tr>
<tr><td align="center" style="Margin:0;padding-left:10px;padding-right:10px;padding-top:15px;padding-bottom:15px;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="95%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:1px solid #cccccc;background:unset;height:0px;width:100%;margin:0px"></td></tr></tbody></table></td></tr>
<tr><td align="left" style="Margin:0;padding-top:5px;padding-bottom:5px;padding-left:20px;padding-right:20px"><h2 style="Margin:0;line-height:20.4px;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;font-size:17px;font-style:normal;font-weight:bold;color:#000000"><strong><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL000ZjJsdiJ9.jgh5Uz6NY6Ak3du3W5gcgbEts_Kjz4TFSVlLX1hIwWo" style="text-decoration:none;color:#000000;font-size:17px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL000ZjJsdiJ9.jgh5Uz6NY6Ak3du3W5gcgbEts_Kjz4TFSVlLX1hIwWo&amp;source=gmail&amp;ust=1756734481224000&amp;usg=AOvVaw0DlH0_JjGuDNFmuhjNxazA">Google rolls out NotebookLM multilingual upgrade, expanding Video and Audio Overviews features to 80 global languages</a></strong></h2></td></tr>
<tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="padding:0;Margin:0;padding-left:20px;padding-right:20px"><p style="Margin:0;font-family:recursive,sans-serif;line-height:19.5px;color:#2d59f5;font-size:13px">1,943 Likes</p></td></tr><tr><td align="center" style="padding:5px;Margin:0;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="95%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:0px solid #cccccc;background:unset;height:0px;width:100%;margin:0px"></td></tr></tbody></table></td></tr><tr><td align="left" style="padding:0;Margin:0"></td></tr></tbody></table></td></tr>
<tr><td align="center" style="padding:0;Margin:0;width:600px" valign="top"><table bgcolor="#FFFFFF" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px;background-color:#ffffff" width="100%"><tbody><tr><td align="left" style="padding:0;Margin:0"></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table>
<table align="center" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content" role="none" style="border-collapse:collapse;border-spacing:0px;table-layout:fixed!important;width:100%"><tbody><tr><td align="center" style="padding:0;Margin:0"><table align="center" bgcolor="#ffffff" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content-body" role="none" style="border-collapse:collapse;border-spacing:0px;background-color:transparent;width:600px"><tbody><tr><td align="left" style="padding:0;Margin:0;padding-left:20px;padding-right:20px"><table cellpadding="0" cellspacing="0" role="none" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td align="center" style="padding:0;Margin:0;width:560px" valign="top"><table cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td align="center" style="padding:15px;Margin:0;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:0px solid #cccccc;background:unset;height:0px;width:100%;margin:0px"></td>
</tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table>
<table align="center" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content" role="none" style="border-collapse:collapse;border-spacing:0px;table-layout:fixed!important;width:100%"><tbody><tr><td align="center" style="padding:0;Margin:0"><table align="center" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content-body" role="none" style="border-collapse:collapse;border-spacing:0px;background-color:transparent;width:600px"><tbody><tr><td align="left" style="padding:0;Margin:0"><table cellpadding="0" cellspacing="0" role="none" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td align="center" style="padding:0;Margin:0;width:600px" valign="top"><table bgcolor="#FFFFFF" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px;border-left:1px solid #000000;border-right:1px solid #000000;border-top:1px solid #000000;border-bottom:1px solid #000000;background-color:#ffffff" width="100%"><tbody><tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="Margin:0;padding-bottom:10px;padding-top:15px;padding-left:20px;padding-right:20px"><h3 style="Margin:0;line-height:18px;font-family:recursive,sans-serif;font-size:15px;font-style:normal;font-weight:bold;color:#000000">TOP_PAPERS</h3>
</td></tr><tr><td align="center" style="padding:0;Margin:0;padding-bottom:20px;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="95%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:1px solid #000000;background:unset;height:0px;width:100%;margin:0px"></td></tr></tbody></table></td></tr>
<tr><td align="left" style="padding:0;Margin:0;padding-bottom:5px;padding-left:20px;padding-right:20px"><h2 style="Margin:0;line-height:20.4px;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;font-size:17px;font-style:normal;font-weight:bold;color:#000000"><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL3k1a1lrMCJ9.zK_gH1hZi4QQ08dTTcuPvTS8CtxQ4tldCApn3k5KLuU" style="text-decoration:none;color:#000000;font-size:17px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL3k1a1lrMCJ9.zK_gH1hZi4QQ08dTTcuPvTS8CtxQ4tldCApn3k5KLuU&amp;source=gmail&amp;ust=1756734481225000&amp;usg=AOvVaw3ZH-rOaNzwq_3bJcwQzjSg">Stanford study finds 13% decline in AI-exposed entry-level jobs</a></h2></td></tr><tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="padding:0;Margin:0;padding-left:20px;padding-right:20px"><p style="Margin:0;font-family:recursive,sans-serif;line-height:19.5px;color:#2d59f5;font-size:13px">1,358 Likes</p></td></tr>
<tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="padding:0;Margin:0;padding-top:10px;padding-left:20px;padding-right:35px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Using payroll records through July 2025, the report shows early‑career workers in AI‑vulnerable roles face a 13% employment decline. The decline arises from job reductions, not wage cuts, while older and less‑exposed workers hold steady or grow.</p></td></tr>
<tr><td align="center" style="padding:20px;Margin:0;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:1px solid #cccccc;background:unset;height:0px;width:100%;margin:0px"></td></tr></tbody></table></td></tr>
<tr><td align="left" style="padding:0;Margin:0;padding-bottom:5px;padding-left:20px;padding-right:20px"><h2 style="Margin:0;line-height:24px;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;font-size:20px;font-style:normal;font-weight:bold;color:#000000"><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiIn0.UmxdER4Kvxno6s_N4mTwutsk9oNFCP-9no0LbmdfzGs" style="text-decoration:none;color:#000000;font-size:20px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiIn0.UmxdER4Kvxno6s_N4mTwutsk9oNFCP-9no0LbmdfzGs&amp;source=gmail&amp;ust=1756734481225000&amp;usg=AOvVaw0v_aIhqfW6mRYy3gdMA7XI"></a><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiIn0.UmxdER4Kvxno6s_N4mTwutsk9oNFCP-9no0LbmdfzGs" style="text-decoration:none;color:#000000;font-size:20px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiIn0.UmxdER4Kvxno6s_N4mTwutsk9oNFCP-9no0LbmdfzGs&amp;source=gmail&amp;ust=1756734481225000&amp;usg=AOvVaw0v_aIhqfW6mRYy3gdMA7XI"></a></h2>
<h2 style="Margin:0;line-height:20.4px;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;font-size:17px;font-style:normal;font-weight:bold;color:#000000"><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL3NCeTVjbyJ9.9W2-LlFz4FYXQQuByz8Dm6nQF62j-wArkGul0dqFuks" style="text-decoration:none;color:#000000;font-size:17px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL3NCeTVjbyJ9.9W2-LlFz4FYXQQuByz8Dm6nQF62j-wArkGul0dqFuks&amp;source=gmail&amp;ust=1756734481225000&amp;usg=AOvVaw2V2_yLZgD52gIX0gQ4IXtR">LLM agents learn from past tasks, not from gradients or retraining</a></h2></td></tr><tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="padding:0;Margin:0;padding-left:20px;padding-right:20px"><p style="Margin:0;font-family:recursive,sans-serif;line-height:19.5px;color:#2d59f5;font-size:13px">1,148 Likes</p></td></tr>
<tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="padding:0;Margin:0;padding-top:10px;padding-left:20px;padding-right:35px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">This paper proposes a memory-based framework that continuously trains LLM agents without updating model weights. It skips gradient updates, instead learning policies through episodic memory and case reuse.</p><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:24px;color:#000000;font-size:16px;display:none"><br></p></td></tr>
<tr><td align="center" style="padding:20px;Margin:0;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:1px solid #cccccc;background:unset;height:0px;width:100%;margin:0px"></td></tr></tbody></table></td></tr>
<tr><td align="left" style="padding:0;Margin:0;padding-bottom:5px;padding-left:20px;padding-right:20px"><h2 style="Margin:0;line-height:24px;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;font-size:20px;font-style:normal;font-weight:bold;color:#000000"><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiIn0.UmxdER4Kvxno6s_N4mTwutsk9oNFCP-9no0LbmdfzGs" style="text-decoration:none;color:#000000;font-size:20px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiIn0.UmxdER4Kvxno6s_N4mTwutsk9oNFCP-9no0LbmdfzGs&amp;source=gmail&amp;ust=1756734481225000&amp;usg=AOvVaw0v_aIhqfW6mRYy3gdMA7XI"></a><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiIn0.UmxdER4Kvxno6s_N4mTwutsk9oNFCP-9no0LbmdfzGs" style="text-decoration:none;color:#000000;font-size:20px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiIn0.UmxdER4Kvxno6s_N4mTwutsk9oNFCP-9no0LbmdfzGs&amp;source=gmail&amp;ust=1756734481225000&amp;usg=AOvVaw0v_aIhqfW6mRYy3gdMA7XI"></a></h2>
<h2 style="Margin:0;line-height:20.4px;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;font-size:17px;font-style:normal;font-weight:bold;color:#000000"><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpLzJra2ptciJ9.Qk3Zdao5-AXY6L02v1Oe6gZZ8QQS_ZcFIAQFB69yW1o" style="text-decoration:none;color:#000000;font-size:17px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpLzJra2ptciJ9.Qk3Zdao5-AXY6L02v1Oe6gZZ8QQS_ZcFIAQFB69yW1o&amp;source=gmail&amp;ust=1756734481225000&amp;usg=AOvVaw2Jr0ro0hWUBSoQTUPofHmZ">Google trains LLMs to predict system metrics without tabular data</a></h2></td></tr><tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="padding:0;Margin:0;padding-left:20px;padding-right:20px"><p style="Margin:0;font-family:recursive,sans-serif;line-height:19.5px;color:#2d59f5;font-size:13px">538 Likes</p></td></tr>
<tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="Margin:0;padding-top:10px;padding-bottom:10px;padding-left:20px;padding-right:35px"><p style="Margin:0;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;line-height:22.5px;color:#000000;font-size:15px">Google proposes a text-based regression method where LLMs predict compute efficiency from raw system logs. The model avoids feature engineering, generalizes to unseen clusters, and enables fast, uncertainty-aware simulation for industrial-scale optimization.</p></td></tr>
<tr><td align="center" style="padding:10px;Margin:0;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:0px solid #ffffff;background:unset;height:0px;width:100%;margin:0px"></td></tr></tbody></table></td></tr><tr><td align="left" style="padding:0;Margin:0"></td></tr></tbody></table></td></tr><tr><td align="center" style="padding:0;Margin:0;width:600px" valign="top"><table bgcolor="#FFFFFF" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px;background-color:#ffffff" width="100%"><tbody><tr><td align="left" style="padding:0;Margin:0"></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table>
</td></tr></tbody></table>
<table align="center" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content" role="none" style="border-collapse:collapse;border-spacing:0px;table-layout:fixed!important;width:100%"><tbody><tr><td align="center" style="padding:0;Margin:0"><table align="center" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content-body" role="none" style="border-collapse:collapse;border-spacing:0px;background-color:transparent;width:600px"><tbody><tr><td align="left" style="padding:0;Margin:0"><table cellpadding="0" cellspacing="0" role="none" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td align="center" style="padding:0;Margin:0;width:600px" valign="top"><table bgcolor="#FFFFFF" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px;background-color:#ffffff" width="100%"><tbody><tr><td align="left" style="padding:0;Margin:0"></td>
</tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table>
<table align="center" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content" role="none" style="border-collapse:collapse;border-spacing:0px;table-layout:fixed!important;width:100%"><tbody><tr><td align="center" style="padding:0;Margin:0"><table align="center" bgcolor="#ffffff" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content-body" role="none" style="border-collapse:collapse;border-spacing:0px;background-color:transparent;width:600px"><tbody><tr><td align="left" style="padding:0;Margin:0;padding-left:20px;padding-right:20px"><table cellpadding="0" cellspacing="0" role="none" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td align="center" style="padding:0;Margin:0;width:560px" valign="top"><table cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td align="center" style="padding:15px;Margin:0;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:0px solid #cccccc;background:unset;height:0px;width:100%;margin:0px"></td>
</tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table>
<table align="center" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content" role="none" style="border-collapse:collapse;border-spacing:0px;table-layout:fixed!important;width:100%"><tbody><tr><td align="center" style="padding:0;Margin:0"><table align="center" bgcolor="#ffffff" cellpadding="0" cellspacing="0" class="m_-4901284468925022273es-content-body" role="none" style="border-collapse:collapse;border-spacing:0px;background-color:transparent;width:600px"><tbody><tr><td align="left" style="padding:0;Margin:0"><table cellpadding="0" cellspacing="0" role="none" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td align="center" style="padding:0;Margin:0;width:600px" valign="top"><table bgcolor="#FFFFFF" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px;border-left:1px solid #000000;border-right:1px solid #000000;border-top:1px solid #000000;border-bottom:1px solid #000000;background-color:#ffffff" width="100%"><tbody><tr><td align="left" class="m_-4901284468925022273es-m-txt-l" style="Margin:0;padding-bottom:10px;padding-top:15px;padding-left:20px;padding-right:20px"><h3 style="Margin:0;line-height:18px;font-family:recursive,sans-serif;font-size:15px;font-style:normal;font-weight:bold;color:#000000">PRODUCT_DEEP_DIVE</h3>
</td></tr><tr><td align="center" style="padding:0;Margin:0;padding-bottom:10px;font-size:0"><table border="0" cellpadding="0" cellspacing="0" height="100%" role="presentation" style="border-collapse:collapse;border-spacing:0px" width="100%"><tbody><tr><td style="padding:0;Margin:0;border-bottom:1px solid #000000;background:unset;height:0px;width:100%;margin:0px"></td></tr></tbody></table></td></tr>
<tr><td align="left" style="Margin:0;padding-top:5px;padding-bottom:5px;padding-left:20px;padding-right:20px"><h2 style="Margin:0;line-height:24px;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;font-size:20px;font-style:normal;font-weight:bold;color:#000000"><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiIn0.UmxdER4Kvxno6s_N4mTwutsk9oNFCP-9no0LbmdfzGs" style="text-decoration:none;color:#000000;font-size:20px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiIn0.UmxdER4Kvxno6s_N4mTwutsk9oNFCP-9no0LbmdfzGs&amp;source=gmail&amp;ust=1756734481225000&amp;usg=AOvVaw0v_aIhqfW6mRYy3gdMA7XI"></a><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiIn0.UmxdER4Kvxno6s_N4mTwutsk9oNFCP-9no0LbmdfzGs" style="text-decoration:none;color:#000000;font-size:20px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiIn0.UmxdER4Kvxno6s_N4mTwutsk9oNFCP-9no0LbmdfzGs&amp;source=gmail&amp;ust=1756734481225000&amp;usg=AOvVaw0v_aIhqfW6mRYy3gdMA7XI"></a></h2><h2 style="Margin:0;line-height:20.4px;font-family:roboto,'helvetica neue',helvetica,arial,sans-serif;font-size:17px;font-style:normal;font-weight:bold;color:#000000">How Google Built Nano-Banana: Smart, Multistep Image Generation</h2></td></tr>
<tr><td align="center" style="padding:0;Margin:0;font-size:0px"><a href="https://alphasignal.ai/api/email/track-click?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL3FFR2VXdiJ9.nReWSsu6mQ3_00VWiHsCtFySL9t28zqd0F5e9IkH35I" style="text-decoration:none;color:#000000;font-size:16px" target="_blank" data-saferedirecturl="https://www.google.com/url?q=https://alphasignal.ai/api/email/track-click?token%3DeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InNheWFudGFubmFuZGkxM0BnbWFpbC5jb20iLCJhc19jYW1wYWlnbl9pZCI6ImJiYzc3MjM3MmY3NmNlOTAiLCJzdWJqZWN0IjoiXHUyNmExXHVmZTBmIEdvb2dsZVx1MjAxOXMgVmlyYWwgTmFubyBCYW5hbmEgQmVhdHMgT3BlbkFJICYgRmx1eCBpbiBBSSBJbWFnZSBFZGl0aW5nIiwidXJsIjoiaHR0cHM6Ly9saW5rLmFscGhhc2lnbmFsLmFpL3FFR2VXdiJ9.nReWSsu6mQ3_00VWiHsCtFySL9t28zqd0F5e9IkH35I&amp;source=gmail&amp;ust=1756734481225000&amp;usg=AOvVaw3mxZ0cb7VwST0w26NtBAPC"><img alt="alpha_signal_image_4" class="m_-4901284468925022273adapt-img CToWUd" src="https://ci3.googleusercontent.com/meips/ADKq_NbLc6LWTiSOe5M4I1Fmshn4HmZn8nOljrmJxuzokB3qbPL0_A8tUoEYKWO-QHkNFmNxKwQgmhpjDoQ_s78fc6WcxrIUi9x4XUL5y92jruG6L4zNRB_SKhgKul693bRAFTHVXx1JBfakJr3MoLPEhfd2jaVUlRA2cv5CspPD_Sbqxg8UTB2qgT3eMpxSziLdHYrD3LarxhMYed-YOp4eWaoIQCjeqRMjgWgEjrSWeSrsETLMSEbcoEyxBNJw=s0-d-e1-ft#https://content.app-us1.com/cdn-cgi/image/width=650,dpr=2,fit=scale-down,format=auto,UNUSED_error=redirect/QMZOW/2025/08/27/3d64c961-a355-4849-a6a4-ea88d5372f5e.jpeg" style="display:block;border:0;outline:none;text-decoration:none" width="573" data-bit="iit"></a></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table></div><div class="iX">...<br><br>[Message clipped]&nbsp;&nbsp;<a href="https://mail.google.com/mail/u/0?ui=2&amp;ik=bdf4b5dc92&amp;view=lg&amp;permmsgid=msg-f:1841649431512297169" target="_blank">View entire message</a></div></div>
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
