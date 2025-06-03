import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { User } from "../models/user.models.js";
import { uploadOnCloudinary, deleteFromCloudinary } from "../utils/cloudinary.js";
import jwt from "jsonwebtoken";


//access and refresh tokens

const generateAccessAndRefreshToken = async (userId) => {
    try {
        const user = await User.findById(userId)
    const accessToken = user.generateAccessToken()
    const refreshToken = user.generateRefreshToken()
    

    user.refreshToken = refreshToken
    await user.save({validateBeforeSave : false})
    return {accessToken , refreshToken}

    } catch (error) {
        throw new ApiError(400 , "Something went wrong while generating access and refresh tokens")
    }


}



// Helper function to clean up Cloudinary assets if user creation fails
const cleanupAssets = async (assets) => {
    try {
        await Promise.all(
            assets.filter(Boolean).map(asset => 
                deleteFromCloudinary(asset.public_id)
            )
        );
    } catch (cleanupError) {
        console.error("Cleanup error:", cleanupError);
    }
};

const registerUser = asyncHandler(async (req, res) => {
    // Destructure and validate input
    const { fullname, email, username, password } = req.body;

    if ([fullname, email, username, password].some(field => !field?.trim())) {
        throw new ApiError(400, "All fields are required");
    }

    // Check for existing user
    const existedUser = await User.findOne({
        $or: [{ username }, { email }]
    });

    if (existedUser) {
        throw new ApiError(409, "User with email or username already exists");
    }

    // Validate files
    const avatarLocalPath = req.files?.avatar?.[0]?.path;
    const coverLocalPath = req.files?.coverImage?.[0]?.path;

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is required");
    }

    // Upload assets to Cloudinary
    let avatar, coverImage;
    try {
        // Upload avatar (required)
        avatar = await uploadOnCloudinary(avatarLocalPath);
        if (!avatar?.url) {
            throw new ApiError(500, "Failed to upload avatar");
        }

        // Upload cover image (optional)
        if (coverLocalPath) {
            coverImage = await uploadOnCloudinary(coverLocalPath);
            // Cover image failure shouldn't block registration
            if (!coverImage?.url) {
                console.warn("Cover image upload failed but continuing registration");
            }
        }
    } catch (uploadError) {
        console.error("Upload error:", uploadError);
        throw new ApiError(500, "Failed to upload one or more files");
    }

    // Create user in database
    try {
        const user = await User.create({
            fullname,
            avatar: avatar.url,
            coverImage: coverImage?.url || "",
            email,
            password,
            username: username.toLowerCase() // Fixed typo here
        });

        const createdUser = await User.findById(user._id).select(
            "-password -refreshToken"
        );

        if (!createdUser) {
            // Clean up uploaded assets if user creation failed
            await cleanupAssets([avatar, coverImage]);
            throw new ApiError(500, "Failed to create user after file upload");
        }

        return res
            .status(201)
            .json(new ApiResponse(201, createdUser, "User registered successfully"));

    } catch (dbError) {
        console.error("Database error:", dbError);
        
        // Clean up uploaded assets if user creation failed
        await cleanupAssets([avatar, coverImage]);
        
        throw new ApiError(500, 
            dbError.code === 11000 
                ? "Username or email already exists" 
                : "Failed to register user"
        );
    }
});


const loginUser = asyncHandler(async (req , res) => {
    //get data from body

    const {email, username, password} = req.body

    //validation

    if(!email){
        throw new ApiError(400, "email is reqired")
    }

    const user = await User.findOne({
        $or: [{username},{email}]
    })
    if(!user){
        throw new ApiError(400 , "User not found")
    }

    //validate password
    const isPasswordValid = await user.isPasswordCorrect(password)
    if(!isPasswordValid){
        throw new ApiError(401 , "Invalid credentials")
    }

    const {accessToken , refreshToken} = await generateAccessAndRefreshToken(user._id)

    const loggedInUser = await User.findById(user._id)
    .select("-password -refreshToken")

    if(!loggedInUser){
        throw new ApiError(400 , "login failed")
    }

    const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
    }

    return res
    .status(200)
    .cookie("accessToken" , accessToken , options)
    .cookie("refreshToken" , refreshToken , options)
    .json (new ApiResponse(
        200,
        {user: loggedInUser , accessToken , refreshToken},
        "User logged in successfully"
    ))
})

const logoutUser = asyncHandler ( async(req , res) => {
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $set : {
                refreshToken: undefined,
            }
        },
        {new: true}
    )

    const options = {
        httpOnly:true,
        secure: process.env.NODE_ENV === "production",
    }

    return res
    .status(200)
    .clearCookie("accessToken" , options)
    .clearCookie("refreshToken" , options)
    .json( new ApiResponse(200 , {} ,"User logged out successfully"))
})


const refreshAccessToken = asyncHandler( async (req , res) => {
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken

    if(!incomingRefreshToken){
        throw new ApiError(401 , "Refresh token is required")
    }

    try {
        const decodedToken = jwt.verify(
            incomingRefreshToken , process.env.REFRESH_TOKEN_SECRET
        )
        const user = await User.findById(decodedToken?._id)

        if(!user){
            throw new ApiError(401 , "Invalid refresh token")
        }
        if(incomingRefreshToken !== user?.refreshToken){
            throw new ApiError(401 , "Invalid refresh token")
        }

        const options = {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production"
        }

        const {accessToken , refreshToken: newRefreshToken} = await generateAccessAndRefreshToken(user._id)

        return res
        .status(200)
        .cookie("accessToken" , accessToken , options)
        .json( new ApiResponse(200 , {accessToken , refreshToken: newRefreshToken},"Access token refreshed successfully"))


    } catch (error) {
        throw new ApiError(500 , "Something went wrong while refreshing access token")
    }
})

export { 
    registerUser ,
    loginUser,
    refreshAccessToken,
    logoutUser
};