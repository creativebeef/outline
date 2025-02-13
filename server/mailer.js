// @flow
import * as Sentry from "@sentry/node";
import debug from "debug";
import nodemailer from "nodemailer";
import Oy from "oy-vey";
import * as React from "react";
import {
  type Props as CollectionNotificationEmailT,
  CollectionNotificationEmail,
  collectionNotificationEmailText,
} from "./emails/CollectionNotificationEmail";
import {
  type Props as DocumentNotificationEmailT,
  DocumentNotificationEmail,
  documentNotificationEmailText,
} from "./emails/DocumentNotificationEmail";
import {
  ExportFailureEmail,
  exportEmailFailureText,
} from "./emails/ExportFailureEmail";

import {
  ExportSuccessEmail,
  exportEmailSuccessText,
} from "./emails/ExportSuccessEmail";
import {
  type Props as InviteEmailT,
  InviteEmail,
  inviteEmailText,
} from "./emails/InviteEmail";
import { SigninEmail, signinEmailText } from "./emails/SigninEmail";
import { WelcomeEmail, welcomeEmailText } from "./emails/WelcomeEmail";
import { baseStyles } from "./emails/components/EmailLayout";
import { emailsQueue } from "./queues";

const log = debug("emails");
const useTestEmailService =
  process.env.NODE_ENV === "development" && !process.env.SMTP_USERNAME;

export type EmailTypes = "welcome" | "export" | "invite" | "signin";

export type EmailSendOptions = {
  to: string,
  properties?: any,
  title: string,
  previewText?: string,
  text: string,
  html: React.Node,
  headCSS?: string,
};

/**
 * Mailer
 *
 * Mailer class to contruct and send emails.
 *
 * To preview emails, add a new preview to `emails/index.js` if they
 * require additional data (properties). Otherwise preview will work automatically.
 *
 * HTML: http://localhost:3000/email/:email_type/html
 * TEXT: http://localhost:3000/email/:email_type/text
 */
export class Mailer {
  transporter: ?any;

  constructor() {
    this.loadTransport();
  }

  async loadTransport() {
    if (process.env.SMTP_HOST) {
      let smtpConfig = {
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure:
          "SMTP_SECURE" in process.env
            ? process.env.SMTP_SECURE === "true"
            : process.env.NODE_ENV === "production",
        auth: undefined,
        tls:
          "SMTP_TLS_CIPHERS" in process.env
            ? { ciphers: process.env.SMTP_TLS_CIPHERS }
            : undefined,
      };

      if (process.env.SMTP_USERNAME) {
        smtpConfig.auth = {
          user: process.env.SMTP_USERNAME,
          pass: process.env.SMTP_PASSWORD,
        };
      }

      this.transporter = nodemailer.createTransport(smtpConfig);
      return;
    }

    if (useTestEmailService) {
      log("SMTP_USERNAME not provided, generating test account…");

      try {
        let testAccount = await nodemailer.createTestAccount();

        const smtpConfig = {
          host: "smtp.ethereal.email",
          port: 587,
          secure: false,
          auth: {
            user: testAccount.user,
            pass: testAccount.pass,
          },
        };

        this.transporter = nodemailer.createTransport(smtpConfig);
      } catch (err) {
        log(`Could not generate test account: ${err.message}`);
      }
    }
  }

  sendMail = async (data: EmailSendOptions): ?Promise<*> => {
    const { transporter } = this;

    if (transporter) {
      const html = Oy.renderTemplate(data.html, {
        title: data.title,
        headCSS: [baseStyles, data.headCSS].join(" "),
        previewText: data.previewText,
      });

      try {
        log(`Sending email "${data.title}" to ${data.to}`);
        const info = await transporter.sendMail({
          from: process.env.SMTP_FROM_EMAIL,
          replyTo: process.env.SMTP_REPLY_EMAIL || process.env.SMTP_FROM_EMAIL,
          to: data.to,
          subject: data.title,
          html: html,
          text: data.text,
        });

        if (useTestEmailService) {
          log("Email Preview URL: %s", nodemailer.getTestMessageUrl(info));
        }
      } catch (err) {
        if (process.env.SENTRY_DSN) {
          Sentry.captureException(err);
        }
        throw err; // Re-throw for queue to re-try
      }
    }
  };

  welcome = async (opts: { to: string, teamUrl: string }) => {
    this.sendMail({
      to: opts.to,
      title: "Welcome to Outline",
      previewText:
        "Outline is a place for your team to build and share knowledge.",
      html: <WelcomeEmail {...opts} />,
      text: welcomeEmailText(opts),
    });
  };

  exportSuccess = async (opts: { to: string, id: string, teamUrl: string }) => {
    this.sendMail({
      to: opts.to,
      title: "Your requested export",
      previewText: "Here's your request data export from Outline",
      html: <ExportSuccessEmail id={opts.id} teamUrl={opts.teamUrl} />,
      text: exportEmailSuccessText,
    });
  };

  exportFailure = async (opts: { to: string, teamUrl: string }) => {
    this.sendMail({
      to: opts.to,
      title: "Your requested export",
      previewText: "Sorry, your requested data export has failed",
      html: <ExportFailureEmail teamUrl={opts.teamUrl} />,
      text: exportEmailFailureText,
    });
  };

  invite = async (opts: { to: string } & InviteEmailT) => {
    this.sendMail({
      to: opts.to,
      title: `${opts.actorName} invited you to join ${opts.teamName}’s knowledge base`,
      previewText:
        "Outline is a place for your team to build and share knowledge.",
      html: <InviteEmail {...opts} />,
      text: inviteEmailText(opts),
    });
  };

  signin = async (opts: { to: string, token: string, teamUrl: string }) => {
    this.sendMail({
      to: opts.to,
      title: "Magic signin link",
      previewText: "Here’s your link to signin to Outline.",
      html: <SigninEmail {...opts} />,
      text: signinEmailText(opts),
    });
  };

  documentNotification = async (
    opts: { to: string } & DocumentNotificationEmailT
  ) => {
    this.sendMail({
      to: opts.to,
      title: `“${opts.document.title}” ${opts.eventName}`,
      previewText: `${opts.actor.name} ${opts.eventName} a new document`,
      html: <DocumentNotificationEmail {...opts} />,
      text: documentNotificationEmailText(opts),
    });
  };

  collectionNotification = async (
    opts: { to: string } & CollectionNotificationEmailT
  ) => {
    this.sendMail({
      to: opts.to,
      title: `“${opts.collection.name}” ${opts.eventName}`,
      previewText: `${opts.actor.name} ${opts.eventName} a collection`,
      html: <CollectionNotificationEmail {...opts} />,
      text: collectionNotificationEmailText(opts),
    });
  };

  sendTemplate = async (type: EmailTypes, opts?: Object = {}) => {
    await emailsQueue.add(
      {
        type,
        opts,
      },
      {
        attempts: 5,
        removeOnComplete: true,
        backoff: {
          type: "exponential",
          delay: 60 * 1000,
        },
      }
    );
  };
}

const mailer = new Mailer();
export default mailer;
