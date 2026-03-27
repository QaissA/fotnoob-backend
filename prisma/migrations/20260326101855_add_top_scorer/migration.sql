-- CreateTable
CREATE TABLE "TopScorer" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "goals" INTEGER NOT NULL,
    "assists" INTEGER,
    "penalties" INTEGER,
    "playedGames" INTEGER NOT NULL,

    CONSTRAINT "TopScorer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TopScorer_seasonId_idx" ON "TopScorer"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "TopScorer_seasonId_playerId_key" ON "TopScorer"("seasonId", "playerId");

-- AddForeignKey
ALTER TABLE "TopScorer" ADD CONSTRAINT "TopScorer_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
