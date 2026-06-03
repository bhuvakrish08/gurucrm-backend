const express = require("express");
const cors = require("cors");
require("dotenv").config();
const loginRoutes = require("./routes/loginRoutes");
const todoRoutes = require("./routes/todos")
const customerRoutes = require("./routes/customers")
const contactDesignationRoutes = require("./routes/contactDesignation")
const organizationRoutes = require("./routes/organizations")
const roleMasterRoutes = require("./routes/roleMaster")
const designationMasterRoutes = require("./routes/designationMaster")
const inquiryLeadCategoryRoutes = require("./routes/inquiryLeadCategory")
const inquiryLeadSourceRoutes = require("./routes/inquiryLeadSource")
const inquiryLeadActivityRoutes = require("./routes/inquiryLeadActivity")
const ticketTypeRoutes = require("./routes/ticketType")
const ticketSourceRoutes = require("./routes/ticketSource")
const ticketSupportRoutes = require("./routes/ticketSupport")
const taskStatusRoutes = require("./routes/taskStatus")
const expenseCategoryRoutes = require("./routes/expenseCategory")
const expenseSubCategoryRoutes = require("./routes/expenseSubCategory")
const contractsRoutes = require("./routes/contracts")
const quotationRoutes = require("./routes/quotation")
const productMasterRoutes = require("./routes/productMaster")
const productCategoryRoutes = require("./routes/productCategory")
const productUnitRoutes = require("./routes/productUnit")
const IndustriesRoutes = require("./routes/industries")
const ContactsRoutes = require("./routes/contacts")
const OrgNotificationsRoutes = require("./routes/orgNotifications")
const ManageUsersRoutes = require("./routes/manageUser")
const InquiryRoutes = require("./routes/inquiry")
const TasksRoutes = require("./routes/tasks")
const ContractsRoutes = require("./routes/contracts-list")
const lead = require("./routes/lead");
const lead_follow_up = require('./routes/leadFollowUp')
const quotationMainRoutes = require('./routes/quotationMain')
const pi = require('./routes/perfomainvoices')
const activitiesRoutes = require('./routes/activities');
const quotationRevisionRoutes = require("./routes/quotationRevision");



const app = express();
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json());

app.use("/api", loginRoutes);
app.use("/api/todos", todoRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/contact", contactDesignationRoutes);
app.use("/api/organizations", organizationRoutes);
app.use("/api/role-master", roleMasterRoutes);
app.use("/api/designation-master", designationMasterRoutes);
app.use("/api/inquiry-lead-category", inquiryLeadCategoryRoutes);
  
app.use("/api/inquiry-lead-source", inquiryLeadSourceRoutes);

app.use("/api/inquiry-lead-activity", inquiryLeadActivityRoutes);
app.use("/api/ticket-type", ticketTypeRoutes);
app.use("/api/ticket-source", ticketSourceRoutes);
app.use("/api/ticket-support", ticketSupportRoutes);
app.use("/api/task-status", taskStatusRoutes);
app.use("/api/expense-category", expenseCategoryRoutes);
app.use("/api/expense-sub-category", expenseSubCategoryRoutes);
app.use("/api/contract-types", contractsRoutes);
app.use("/api/quote-status", quotationRoutes);
app.use("/api/product-master", productMasterRoutes);
app.use("/api/product-category", productCategoryRoutes);
app.use("/api/product-unit", productUnitRoutes);
app.use("/api/Industries", IndustriesRoutes);
app.use("/api/contacts", ContactsRoutes);
app.use("/api/notifications", OrgNotificationsRoutes);
app.use("/api/manage-user", ManageUsersRoutes);
app.use("/api/inquiry", InquiryRoutes);
app.use("/api/tasks", TasksRoutes);
app.use("/api/contracts-list", ContractsRoutes);
app.use("/api/lead", lead);
app.use("/api/lead-follow-up",lead_follow_up)
app.use("/api/quotation", quotationMainRoutes)
app.use("/api/pi",pi);
app.use("/api/activities", activitiesRoutes);
app.use("/api/quotation-revision", quotationRevisionRoutes);



app.listen(process.env.PORT, () => {
  console.log("Server running");
});
