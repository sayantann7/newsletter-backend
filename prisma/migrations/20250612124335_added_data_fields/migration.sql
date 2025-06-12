-- AlterTable
ALTER TABLE "Email" ADD COLUMN     "currentCompany" TEXT,
ADD COLUMN     "currentLocation" TEXT,
ADD COLUMN     "currentPosition" TEXT,
ADD COLUMN     "experienceYears" INTEGER,
ADD COLUMN     "interestedInJobs" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "jobPreferences" TEXT,
ADD COLUMN     "skills" TEXT;
