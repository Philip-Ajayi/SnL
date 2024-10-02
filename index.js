const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const { formatInTimeZone } = require('date-fns-tz');


const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(bodyParser.json());

// MongoDB connection
const mongoURI = 'mongodb+srv://barryjacob08:HrpYPLgajMiRJBgN@cluster0.ssafp.mongodb.net/yourDBName?retryWrites=true&w=majority';
mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected successfully'))
  .catch(err => console.error('MongoDB connection error:', err));

// User and Attendance Schemas
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  location: { type: String, required: true },
});

const attendanceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  session: { type: String, required: true },
  date: { type: Date, default: Date.now },
});

const User = mongoose.model('User', userSchema);
const Attendance = mongoose.model('Attendance', attendanceSchema);

// Session groups for attendance
const sessionGroups = {
  ministrySchool: ['MinistrySchool1', 'MinistrySchool2', 'MinistrySchool3'],
  class: ['Class1', 'Class2'],
};

// 1. Register a new user
app.post('/api/register', async (req, res) => {
  const { name, email, phone, location } = req.body;

  try {
    // Check for duplicate email or phone
    const existingUserByEmail = await User.findOne({ email });
    if (existingUserByEmail) {
      return res.status(400).json({ success: false, message: 'Email is already in use' });
    }

    const existingUserByPhone = await User.findOne({ phone });
    if (existingUserByPhone) {
      return res.status(400).json({ success: false, message: 'Phone number is already in use' });
    }

    // Create new user
    const newUser = new User({ name, email, phone, location });
    await newUser.save();
    res.status(201).json({ success: true, user: newUser });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. Check if a user exists
app.get('/api/user/:email', async (req, res) => {
  const { email } = req.params;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. Mark attendance for a session
app.post('/api/mark-attendance', async (req, res) => {
  const { email, session } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, code: 'USER_NOT_FOUND', message: 'User not found' });
    }

    // Get today's date in GMT+1
    const today = new Date();
    const gmtPlus1 = formatInTimeZone(today, 'Europe/Berlin', "yyyy-MM-dd'T'00:00:00.000xxx");
    const endOfDay = formatInTimeZone(today, 'Europe/Berlin', "yyyy-MM-dd'T'23:59:59.999xxx");

    const existingAttendance = await Attendance.findOne({
      userId: user._id,
      session,
      date: {
        $gte: new Date(gmtPlus1),
        $lt: new Date(endOfDay),
      },
    });

    if (existingAttendance) {
      return res.json({ success: false, code: 'ALREADY_MARKED', message: 'User has already marked attendance today' });
    }

    // Check if session belongs to a group and overwrite if necessary
    let canOverride = false;
    for (let group in sessionGroups) {
      if (sessionGroups[group].includes(session)) {
        // Check if there is any attendance for today in the group
        const groupAttendances = await Attendance.find({
          userId: user._id,
          session: { $in: sessionGroups[group] },
          date: {
            $gte: new Date(gmtPlus1),
            $lt: new Date(endOfDay),
          },
        });

        if (groupAttendances.length > 0) {
          canOverride = true;
          await Attendance.deleteMany({ userId: user._id, session: { $in: sessionGroups[group] } });
          break; // Exit the loop since we will override
        }
      }
    }

    // Mark new attendance
    const newAttendance = new Attendance({ userId: user._id, session });
    await newAttendance.save();
    res.json({ success: true, attendance: newAttendance });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 4. Get session information (per day)
app.get('/api/session/:session', async (req, res) => {
  const { session } = req.params;
  const today = new Date();
  const gmtPlus1 = formatInTimeZone(today, 'Europe/Berlin', "yyyy-MM-dd'T'00:00:00.000xxx");
  const endOfDay = formatInTimeZone(today, 'Europe/Berlin', "yyyy-MM-dd'T'23:59:59.999xxx");

  try {
    const attendances = await Attendance.find({
      session,
      date: {
        $gte: new Date(gmtPlus1),
        $lt: new Date(endOfDay),
      },
    }).populate('userId', 'name location phone email');

    res.json({ success: true, attendances });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 5. Get all registered users or attendees
app.get('/api/users', async (req, res) => {
  const { type } = req.query; // 'registered' or 'attendees'

  try {
    let users;
    if (type === 'attendees') {
      const today = new Date();
      const gmtPlus1 = formatInTimeZone(today, 'Europe/Berlin', "yyyy-MM-dd'T'00:00:00.000xxx");
      const endOfDay = formatInTimeZone(today, 'Europe/Berlin', "yyyy-MM-dd'T'23:59:59.999xxx");

      const attendees = await Attendance.find({
        date: {
          $gte: new Date(gmtPlus1),
          $lt: new Date(endOfDay),
        },
      }).populate('userId', 'name location phone email');

      users = attendees.map(att => att.userId);
    } else {
      users = await User.find();
    }

    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Serve static files from the Vite `dist` folder
app.use(express.static(path.join(__dirname, 'dist')));

// Fallback route to serve index.html for all unknown routes (Single Page Application)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});


// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
