const express = require("express")
const router = express.Router()
const { createUserValidator, loginUserValidator } = require("../validators/user.js")
const { validationErrorHandler, verifyToken } = require("../middleware/index.js")
const { createUser, loginUser, googleLogin, handleGoogleLogin, forgotPassword, resetPassword} = require("../controllers/user.js")


router.post("/register", createUserValidator, validationErrorHandler, createUser)
router.post("/login", loginUserValidator, validationErrorHandler, loginUser)
router.get("/google-login", handleGoogleLogin)
router.get("/google", googleLogin)
router.get("/me", verifyToken)
router.post("/forgot-password", validationErrorHandler, forgotPassword)
router.get("/reset-password", validationErrorHandler, resetPassword)
module.exports = router