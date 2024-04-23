const { userModel } = require("../model/user.js")
const { tweetModel } = require("../model/tweet.js")
const { resetPaswordTokenModel } = require("../model/resetPassToken.js")
const asyncHandler = require("express-async-handler")
const bcrypt = require('bcrypt')
const crypto = require('crypto');
const axios = require("axios")
const forgotPasswordSendValidate = require('../validators/forgot-password.js')
const resetPasswordValidate = require('../validators/reset-password.js')
const { checkIfEmailExist, signToken, sendEmail } = require("../common/index.js")

const getAllUsers = (async (req, res) => {
    const users = await userModel.find({}).exec()
    res.send(users)
})

const googleLogin = (asyncHandler(async (req, res) => {
    const code = req.query.code
    //Exchange code for token and get user info (Email, name)
    const { data } = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_SECRET,
        code: code,
        redirect_uri: process.env.GOOGLE_REDIRECT,
        grant_type: "authorization_code"
    })
    const { access_token, id_token } = data
    const response = await axios.get("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${access_token}` }
    })
    const userprofile = response.data
    // Check if email exist and create new user
    const ifExist = await checkIfEmailExist(userprofile.email)
    if (ifExist) {
        const existingUser = await userModel.findOne({ email: userprofile.email })
        const token = signToken(existingUser.id, existingUser.email, existingUser.usernames)
        return res.status(200).json({ token })
    }
    // Register 
    const newUser = new userModel({
        username: userprofile.email,
        email: userprofile.email,
        profileType: "sso"
    })
    const result = await newUser.save()
    const token = signToken(result.id, result.email, result.usernames)

    return res.status(200).json({ token })
}))

const handleGoogleLogin = (asyncHandler(async (req, res) => {
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${process.env.GOOGLE_REDIRECT}&response_type=code&scope=profile email`
    res.redirect(url)
}))

const getTweetsByUserId = (asyncHandler(async (req, res) => {
    const id = req.params.id
    const users = await userModel.findById(id).populate('tweets').select('tweets')
    res.send(users)
}))

const getUserById = (async (req, res) => {
    let user = await userModel.findById(req.params.id).exec()
    res.send(user)
})

const deleteById = (async (req, res) => {
    const result = await userModel.deleteOne({ _id: req.params.id })
    res.send(result)
})

const createUser = (asyncHandler(async (req, res) => {
    const { username, email, password } = req.body
    const hashedPassword = await bcrypt.hash(password, 10)
    const newUser = new userModel({
        username: username,
        email: email,
        password: hashedPassword,
        profileType: "normal"
    })
    const result = await newUser.save()
    result.password = ''
    res.send(result)
}))

const loginUser = (asyncHandler(async (req, res) => {
    const { email, password } = req.body
    const user = await userModel.findOne({
        email: email
    })
    //Compare password
    const passwordMatch = await bcrypt.compare(password, user.password)
    if (!passwordMatch) {
        return res.status(401).json({ error: "Password or email incorrect!" })
    }
    //Return JWT to client
    const token = signToken(user._id, user.email, user.username)
    return res.status(200).json({ token })
}))

const updateById = (asyncHandler(async (req, res) => {
    const id = req.params.id
    const updatedUser = await userModel.findByIdAndUpdate(id, req.body, {
        new: true
    })
    res.send(updatedUser)
}))

// forgot password
const forgotPassword = (asyncHandler(async (req, res) => {
    const { email } = req.body

    if (!email) return res.status(401).json({ error: "Email Must be provided!" })
    const emailFounded = await userModel.findOne({ email: email })
    if (!emailFounded) return res.status(401).json({ error: " Email does not exist!" })

    // validate request time
    const SendValidates = await forgotPasswordSendValidate(emailFounded._id)
    if (SendValidates.error) res.status(401).json(SendValidates)
    const tokensHex = crypto.randomBytes(64).toString('hex');
    const magicLink = `${process.env.SERVER_URI}/api/auth/reset-password?id=${emailFounded._id}&token=${tokensHex}`
    const emailOption = {
        from: process.env.SMTP_ADMIN_EMAIL,
        to: emailFounded.email,
        subject: "Reset Your SarPheab Password",
        html: `
        <body>
            <div style="padding:50px; font-family: 'Roboto', Arial; background-color: #ebf2ff;">
                <h1>Hi, <strong>${emailFounded.username.split(" ").slice(0, 1)}</strong></h1>
                <h3 style="width: 100%; text-align: center;">You've requested a password reset</h3>
                <p>It looks like someone submitted a request to reset your SarPheab password. There's nothing to do or worry
                    about if it wasn't you. You can keep on keeping on.
                </p>
                <p>
                If this was you, <b><a href="${magicLink}" style="color: #2a92ff;">Reset Your Password Here</a></b> and
                    get back into your account
                </p>
            </div>
        </body>
        `
    }
    const sendEmailResetPassTokens = await sendEmail(emailOption)
    // console.log(sendEmailResetPassTokens)
    if (sendEmailResetPassTokens.error) return res.status(401).json({ error: true, message: "Something went wrong! Please try again later." })
    const hashedToekn = await bcrypt.hash(tokensHex, 10)
    try {
        let resetPasswordToken = new resetPaswordTokenModel({
            byUser: emailFounded._id,
            token: hashedToekn,
            expireIn: Date.now() + 3600000
        })
        const saveResetPasswordToken = await resetPasswordToken.save()
        if (saveResetPasswordToken) return res.status(200).json({ message: `Password reset successfully, Please Check Your Email ${emailFounded.email}!` })
    } catch (error) {
        return res.status(500).json({ error: true, message: "Internal Server Error!", error })
    }
}))
// reset password 
const resetPassword = (asyncHandler(async (req, res) => {
    try {
        // validate request token and user id
        const tokenValidation = await resetPasswordValidate(req.query)
        if (tokenValidation.error) return res.status(401).json(tokenValidation)
        // update user password
        if (tokenValidation._id) {
            // TODO: Fix 
            const updatedPassword = await resetPaswordTokenModel.findByIdAndUpdate(
                tokenValidation.byUser,
                updatePassWord,
                { new: true } // This option returns the modified document rather than the original
            );
        } else {
            res.status(401).json({ error: true, message: 'Something went wrong, Please try again!' })
        }
    } catch (error) {
        console.log(error)
        res.status(500).json({ error: true, message: " Internal Server Error!" })
    }

}))
module.exports = {
    getAllUsers,
    getUserById,
    deleteById,
    createUser,
    updateById,
    getTweetsByUserId,
    loginUser,
    googleLogin,
    handleGoogleLogin,
    forgotPassword,
    resetPassword
}