import { IsString, MinLength } from "class-validator";

export class ResetPasswordDto {
  @IsString()
  identifier!: string;

  @IsString()
  phone!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;

  @IsString()
  confirmPassword!: string;
}
