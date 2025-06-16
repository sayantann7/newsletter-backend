import express from "express";
import { config } from "dotenv";
config();
import cors from "cors";
import { PrismaClient } from "../src/generated/prisma";
import bcrpyt from "bcrypt";
import { Resend } from "resend";

declare global {
    // eslint-disable-next-line no-var
    var prisma: PrismaClient | undefined;
}

const app = express();
app.use(cors());
app.use(express.json());

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
        const { email, ig_username, totalVotes, voteGiven } = req.body;
        if (!email || !ig_username || totalVotes === undefined || voteGiven === undefined) {
            return res.status(400).send("Email, Instagram username, total votes, and vote given are required");
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
            take: 3,
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
        if (!email) {
            return res.status(400).send("Email is required");
        }

        const subscriber = await prisma.email.findUnique({
            where: { email },
        });

        if (!subscriber) {
            return res.status(404).json({ success: false, message: "Subscriber not found in TP" });
        }

        const contestantData = await prisma.waitlist.findUnique({
            where: { email : contestant },
        });

        if (!contestantData) {
            return res.status(404).json({ success: false, message: "Waitlist entry not found" });
        }

        const updatedContestant = await prisma.waitlist.update({
            where: { email: contestant },
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
        const { email } = req.query;
        if (!email) {
            return res.status(400).send("Email is required");
        }

        const contestant = await prisma.waitlist.findUnique({
            where: { email: email as string },
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




// Export the Express app for Vercel
export default app;