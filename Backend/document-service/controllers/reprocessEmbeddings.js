// Add this endpoint to reprocess files that don't have embeddings
exports.reprocessFileEmbeddings = async (req, res) => {
    const userId = req.user.id;

    try {
        const { file_id } = req.params;

        if (!file_id) {
            return res.status(400).json({ error: "file_id is required" });
        }

        // Get file metadata
        const file = await DocumentModel.getFileById(file_id);
        if (!file) {
            return res.status(404).json({ error: "File not found" });
        }

        if (String(file.user_id) !== String(userId)) {
            return res.status(403).json({ error: "Access denied" });
        }

        console.log(`[reprocessFileEmbeddings] Starting reprocessing for file ${file_id}`);

        // Get existing chunks
        const chunks = await FileChunkModel.getChunksByFileId(file_id);

        if (chunks.length === 0) {
            return res.status(400).json({
                error: "No chunks found for this file. File needs to be fully reprocessed."
            });
        }

        console.log(`[reprocessFileEmbeddings] Found ${chunks.length} chunks`);

        // Check if embeddings already exist
        const embeddingCoverage = await ChunkVectorModel.verifyEmbeddingsForFile(file_id);

        if (embeddingCoverage.isComplete) {
            return res.status(200).json({
                message: "File already has complete embeddings",
                chunks: embeddingCoverage.totalChunks,
                embeddings: embeddingCoverage.totalEmbeddings,
                coverage: embeddingCoverage.coveragePercentage
            });
        }

        console.log(`[reprocessFileEmbeddings] Current coverage: ${embeddingCoverage.coveragePercentage.toFixed(2)}%`);
        console.log(`[reprocessFileEmbeddings] Generating embeddings for ${chunks.length} chunks...`);

        // Generate embeddings for all chunks
        const chunkContents = chunks.map(c => c.content);
        const embeddings = await generateEmbeddings(chunkContents);

        console.log(`[reprocessFileEmbeddings] Generated ${embeddings.length} embeddings`);

        // Prepare vectors to save
        const vectorsToSave = chunks.map((chunk, i) => ({
            chunk_id: chunk.id,
            embedding: embeddings[i],
            file_id: file_id,
        }));

        console.log(`[reprocessFileEmbeddings] Saving ${vectorsToSave.length} embeddings...`);

        // Save embeddings
        await ChunkVectorModel.saveMultipleChunkVectors(vectorsToSave);

        // Verify the save
        const newCoverage = await ChunkVectorModel.verifyEmbeddingsForFile(file_id);

        console.log(`[reprocessFileEmbeddings] ✅ Reprocessing complete. New coverage: ${newCoverage.coveragePercentage.toFixed(2)}%`);

        return res.status(200).json({
            success: true,
            message: "Embeddings regenerated successfully",
            file: {
                id: file.id,
                originalname: file.originalname
            },
            before: {
                chunks: embeddingCoverage.totalChunks,
                embeddings: embeddingCoverage.totalEmbeddings,
                coverage: embeddingCoverage.coveragePercentage
            },
            after: {
                chunks: newCoverage.totalChunks,
                embeddings: newCoverage.totalEmbeddings,
                coverage: newCoverage.coveragePercentage
            }
        });

    } catch (error) {
        console.error("❌ reprocessFileEmbeddings error:", error);
        return res.status(500).json({
            error: "Failed to reprocess embeddings",
            details: error.message
        });
    }
};
