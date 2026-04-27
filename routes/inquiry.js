const express = require("express");
const db = require("../db");
const authenticateToken = require("../middlewares/authMiddleware");

const router = express.Router();


router.post("/insert", (req, res) => {
        const {
        company_name,
        customer_name,
        inquiry_title,
        source,
        category,
        priority,
        description,
        assignees
    } = req.body;

    const sql = `
        INSERT INTO inquiry 
        (company_name, customer_name, inquiry_title, source, category, priority, description)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [
        company_name, customer_name, inquiry_title, source,
        category, priority, description
    ], (err, result) => {

        if (err) return res.status(500).json({ success: false, err });

        const inquiryId = result.insertId;

        // Insert assignees
        const assignList = assignees.map(a => [inquiryId, a]);

        const assignSQL = "INSERT INTO inquiry_assignee (inquiry_id, assignee_name) VALUES ?";

        db.query(assignSQL, [assignList], (err2) => {
            if (err2) return res.status(500).json({ success: false, err: err2 });
            

            res.json({
                success: true,
                message: "Inquiry saved successfully"
            });
        });
    });
});
router.delete('/:id', async (req, res) => {
    const leadId = req.params.id;

    let connection;

    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // ✅ Step 1: Check if lead exists
        const [lead] = await connection.execute(
            'SELECT * FROM `lead` WHERE lead_id = ?',
            [leadId]
        );

        if (lead.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                status: false,
                message: 'Lead not found'
            });
        }

        // ✅ Step 2: Check follow-up records
        const [followUps] = await connection.execute(
            'SELECT follow_up_id FROM lead_follow_up WHERE lead_id = ?',
            [leadId]
        );

        // ✅ Step 3: Delete follow-ups if exist
        if (followUps.length > 0) {
            await connection.execute(
                'DELETE FROM lead_follow_up WHERE lead_id = ?',
                [leadId]
            );
        }


        // ✅ Step 4: Delete lead
        await connection.execute(
            'DELETE FROM `lead` WHERE lead_id = ?',
            [leadId]
        );
        await connection.commit();


        res.json({
            status: true,
            message: followUps.length > 0
                ? 'Follow-ups and lead deleted successfully'
                : 'Lead deleted successfully (no follow-ups found)'
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error(error);

        res.status(500).json({
            status: false,
            message: 'Server error'
        });

    } finally {
        if (connection) connection.release();
    }

});

module.exports = router
