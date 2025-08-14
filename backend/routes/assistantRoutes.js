const express = require('express');
const { parseCommand, lookupStudyTask } = require('../controllers/assistantController');

const router = express.Router();

router.post('/parse-command', parseCommand);
router.post('/lookup-study-task', lookupStudyTask);

module.exports = router;


